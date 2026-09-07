import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { config } from "./config.js";
import { chatStream, getModel, type ChatMessage } from "./llm.js";

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;

const HELP = `
Commands:
  /reset      clear the conversation history
  /reasoning  toggle printing the model's chain of thought
  /history    print the current history
  /help       show this help
  /exit       quit
`;

async function main() {
  let model: string;
  try {
    model = await getModel();
  } catch (error) {
    console.error(`\n${(error as Error).message}\n`);
    process.exit(1);
  }

  console.log(bold("\nIA-local — chat"));
  console.log(dim(`model: ${model}`));
  console.log(dim(`server: ${config.baseURL}`));
  console.log(dim("type /help for commands\n"));

  const history: ChatMessage[] = [
    { role: "system", content: config.systemPrompt },
  ];
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

    if (input === "/reset") {
      history.length = 1; // keep the system prompt
      console.log(dim("history cleared\n"));
      continue;
    }

    if (input === "/reasoning") {
      showReasoning = !showReasoning;
      console.log(dim(`reasoning ${showReasoning ? "shown" : "hidden"}\n`));
      continue;
    }

    if (input === "/history") {
      console.log(dim(JSON.stringify(history, null, 2)));
      continue;
    }

    history.push({ role: "user", content: input });

    let answer = "";
    let sawReasoning = false;
    let sawContent = false;

    try {
      for await (const chunk of chatStream(history)) {
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
      history.pop(); // drop the unanswered user turn
      continue;
    }

    if (!answer) {
      // Reasoning models can spend the whole budget thinking and emit no answer.
      stdout.write(
        dim(
          `\n\n[empty answer — the model likely hit MAX_TOKENS (${config.maxTokens}) while reasoning; raise it in .env]`,
        ),
      );
    }

    // Chain of thought is deliberately not fed back into the history: it is not
    // part of the conversation and would waste context on every turn.
    history.push({ role: "assistant", content: answer });
    stdout.write("\n\n");
  }

  rl.close();
  console.log(dim("bye\n"));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
