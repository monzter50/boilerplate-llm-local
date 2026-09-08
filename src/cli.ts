import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { config } from "./config.js";
import { buildMessages, familyOf, resolveParams } from "./harness.js";
import { hasPrompt, listPrompts } from "./prompts.js";
import { chatStream, getModel, type ChatMessage } from "./llm.js";

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;

const HELP = `
Commands:
  /prompt        list the available prompts
  /prompt <id>   switch to a prompt and clear the history
  /reset         clear the conversation history
  /reasoning     toggle printing the model's chain of thought
  /history       print the current history
  /help          show this help
  /exit          quit
`;

async function main() {
  let model: string;
  try {
    model = await getModel();
  } catch (error) {
    console.error(`\n${(error as Error).message}\n`);
    process.exit(1);
  }

  const family = familyOf(model);
  const params = resolveParams(model);

  console.log(bold("\nIA-local — chat"));
  console.log(dim(`model: ${model} (${family.name})`));
  console.log(dim(`server: ${config.baseURL}`));
  console.log(dim(`temperature: ${params.temperature}`));
  console.log(dim("type /help for commands\n"));

  // The system turn is not kept here: the harness prepends it on every call,
  // so switching prompts does not require rewriting the history.
  const turns: ChatMessage[] = [];
  let promptId: string | undefined;
  let showReasoning = true;

  const rl = readline.createInterface({ input: stdin, output: stdout });

  while (true) {
    const input = (await rl.question(cyan("you › "))).trim();

    if (!input) continue;

    if (input === "/exit" || input === "/quit") break;

    if (input === "/help") {
      console.log(dim(HELP));
      continue;
    }

    if (input === "/prompt" || input.startsWith("/prompt ")) {
      const id = input.slice("/prompt".length).trim();

      if (!id) {
        const available = listPrompts();
        console.log(
          dim(
            available.length
              ? `prompts: ${available.join(", ")}\ncurrent: ${promptId ?? "(default)"}\n`
              : "no prompts/*.md files found\n",
          ),
        );
        continue;
      }

      if (!hasPrompt(id)) {
        console.log(
          dim(`unknown prompt '${id}' — available: ${listPrompts().join(", ")}\n`),
        );
        continue;
      }

      promptId = id;
      turns.length = 0;
      console.log(dim(`prompt set to '${id}', history cleared\n`));
      continue;
    }

    if (input === "/reset") {
      turns.length = 0;
      console.log(dim("history cleared\n"));
      continue;
    }

    if (input === "/reasoning") {
      showReasoning = !showReasoning;
      console.log(dim(`reasoning ${showReasoning ? "shown" : "hidden"}\n`));
      continue;
    }

    if (input === "/history") {
      console.log(dim(JSON.stringify(turns, null, 2)));
      continue;
    }

    turns.push({ role: "user", content: input });

    let answer = "";
    let sawReasoning = false;
    let sawContent = false;

    try {
      const messages = buildMessages({ messages: turns, promptId, model });

      for await (const chunk of chatStream(messages, { model })) {
        if (chunk.kind === "reasoning") {
          if (!showReasoning) continue;
          if (!sawReasoning) {
            stdout.write(dim("\nthinking › "));
            sawReasoning = true;
          }
          stdout.write(dim(chunk.text));
          continue;
        }

        if (!sawContent) {
          stdout.write(bold(`${sawReasoning ? "\n\n" : "\n"}ai › `));
          sawContent = true;
        }
        answer += chunk.text;
        stdout.write(chunk.text);
      }
    } catch (error) {
      console.error(`\n${(error as Error).message}\n`);
      turns.pop(); // drop the unanswered user turn
      continue;
    }

    if (!answer) {
      // Reasoning models can spend the whole budget thinking and emit no answer.
      stdout.write(
        dim(
          `\n\n[empty answer — the model likely hit MAX_TOKENS (${params.maxTokens}) while reasoning; raise it in .env]`,
        ),
      );
    }

    // Chain of thought is deliberately not fed back into the history: it is not
    // part of the conversation and would waste context on every turn.
    turns.push({ role: "assistant", content: answer });
    stdout.write("\n\n");
  }

  rl.close();
  console.log(dim("bye\n"));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
