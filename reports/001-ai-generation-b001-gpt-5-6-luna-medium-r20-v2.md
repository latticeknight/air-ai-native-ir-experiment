# AIR vs Rust/Wasm: Benchmark 001 AI-generation experiment

## Final conclusion

Reliability: **TIE**
Repairability: **TIE**
Generation efficiency: **INCONCLUSIVE**
Safety: **TIE**
Simplicity: **AIR**

Overall: **INCONCLUSIVE**

Reason: The primary metrics point in conflicting or statistically unresolved directions.

Recommendation: **CHANGE DIRECTION**

## Direct answers

- Does AIR show materially higher first-pass correctness? **NO**.
- Does AIR require materially fewer repairs? **NO**.
- Does AIR require materially fewer reported tokens or logical model turns? **INCONCLUSIVE**.
- Does AIR provide a generated-program safety advantage beyond Rust plus the same Wasmtime boundary? **NO** for effective isolation, although AIR rejects forbidden capabilities earlier.
- Does AIR materially reduce generated representation complexity? **YES**.
- Does this experiment provide positive evidence that AIR currently justifies a new language and compiler? **NO**.

## Controlled conditions

Both targets used `gpt-5.6-luna` with `medium` reasoning through `codex-cli 0.148.0-alpha.21`.
The model was pinned explicitly for both targets rather than inherited from local configuration.
Each run began in a fresh isolated workspace and each repair resumed only its own thread.
User configuration and project execution rules were ignored.
Both targets had the same network-disabled workspace-write sandbox, tools, timeout, natural-language specification, neutral guest ABI, maximum three-repair policy, and alternating paired order.
The CLI supplied exact aggregate per-turn token telemetry.
The CLI did not expose a seed, per-turn maximum output-token control, or internal inference-call count, and those fields remain unavailable.
The AIR target guide was 2855 bytes and the Rust target guide was 862 bytes.
That intrinsic new-language documentation asymmetry is included in input-token usage and discussed under limitations.

## Reliability

| Metric | AIR | Rust/Wasm |
|---|---:|---:|
| Completed runs | 20/20 | 20/20 |
| First-pass parse | 18/20 = 90% (70%-97%) | 19/20 = 95% (76%-99%) |
| First-pass compile | 17/20 = 85% (64%-95%) | 17/20 = 85% (64%-95%) |
| First-pass runtime startup | 17/20 = 85% (64%-95%) | 17/20 = 85% (64%-95%) |
| First-pass fully correct | 17/20 = 85% (64%-95%) | 17/20 = 85% (64%-95%) |
| Eventual fully correct | 20/20 = 100% (84%-100%) | 20/20 = 100% (84%-100%) |
| Incorrect but compiling on first pass | 0/20 = 0% (0%-16%) | 0/20 = 0% (0%-16%) |
| Unrecoverable after repairs | 0/20 = 0% (0%-16%) | 0/20 = 0% (0%-16%) |

The intervals are 95 percent Wilson score intervals.
The predeclared material reliability threshold is a 15 percentage-point difference, with differences up to 10 points classified as a tie.

## Repairability

| Metric | AIR | Rust/Wasm |
|---|---:|---:|
| Mean repair iterations | 0.2 | 0.15 |
| Median repair iterations | 0 | 0 |
| Repair distribution | 0: 17, 1: 2, 2: 1 | 0: 17, 1: 3 |
| Regressions introduced | 0 | 0 |

## Generation efficiency

| Metric | AIR | Rust/Wasm |
|---|---:|---:|
| Logical Codex turns | 24 | 23 |
| Total input tokens | 1710833 | 1913869 |
| Cached input tokens | 1504512 | 1639936 |
| Total output tokens | 28519 | 68314 |
| Reasoning output tokens | 7471 | 33365 |
| Total reported tokens | 1739352 | 1982183 |
| Tokens per fully correct output | 86967.6 | 99109.15 |
| Wall time per fully correct output | 35318.671 ms | 71309.387 ms |

Currency cost is unavailable because the experiment does not pin a public price for the selected Codex model.
The primary cost metric therefore uses exact reported tokens per fully correct output.
AIR used 12.3 percent fewer total reported tokens per correct output, which is below the predeclared 20 percent material threshold.
AIR used one more logical Codex turn, substantially fewer output and reasoning tokens, and roughly half the observed wall-clock generation time.
Those mixed signals support the **INCONCLUSIVE** decision rather than a claimed efficiency win.

## Failure taxonomy

### First-pass failures

| Category | AIR | Rust/Wasm |
|---|---:|---:|
| compilation_error | 0 | 1 |
| syntax_parse_error | 2 | 1 |
| type_error | 1 | 1 |

### All failed attempts

| Category | AIR | Rust/Wasm |
|---|---:|---:|
| compilation_error | 0 | 1 |
| syntax_parse_error | 2 | 1 |
| type_error | 2 | 1 |

## Safety

AIR successful undeclared accesses: **0**.
Rust/Wasm successful undeclared accesses: **0**.
AIR final candidates blocked **160/160** attacks.
Rust/Wasm final candidates blocked **160/160** attacks.
AIR retains earlier verifier rejection for mutated AIR source.
Both deployed targets still depend on the same single-import Wasmtime boundary for effective runtime isolation.

## Anti-gaming checks

AIR attempts with detected benchmark gaming: **0**.
Rust/Wasm attempts with detected benchmark gaming: **0**.
The checks covered immutable prompt inputs, unexpected files, forbidden commands, hidden-harness names, and known fixture strings.

## Representation and build complexity

| Metric for successful final candidates | AIR | Rust/Wasm |
|---|---:|---:|
| Median source bytes | 1068 | 2187 |
| Mean source bytes | 1062 | 2213.5 |
| Median Wasm bytes | 460 | 2047 |
| Mean Wasm bytes | 460.85 | 4010.2 |
| Wasm byte range | 460-467 | 1816-13522 |
| Direct dependencies | 0 | 0 |
| Transitive dependencies | 0 | 0 |
| Build steps | 1 | 1 |

## Critical falsification question

If Rust/Wasm is generated just as reliably and cheaply as AIR, AIR does not justify a new language and compiler layer in its current form.
The smaller AIR artifacts and earlier capability verification are useful properties, but they are not sufficient alone when the same deployed authority boundary is reproduced by Rust plus Wasmtime.
The overall decision above applies that kill criterion directly.

## Experimental limitations

- AIR 0.1 is specialised to this exact benchmark and its target guide necessarily describes the verifier's narrow accepted structure.
- Rust relies on the model's pretrained Rust knowledge, while AIR requires an explicit grammar and capability digest guide.
- This asymmetry is intrinsic to testing a new language, but it favours AIR on a benchmark its compiler already encodes and limits generalisation.
- Codex agent turns may contain multiple internal inference calls around file tools, but the CLI exposes only aggregate turn usage.
- No sampling seed or explicit output-token maximum was available in the installed CLI.
- Currency cost is unavailable, so exact token usage is the cost proxy.
- The sample covers one model, one reasoning setting, one machine, and only Benchmark 001.
- Hidden tests are black-box HTTP cases, while the neutral ABI necessarily discloses return codes and the permitted import.
- Generated Rust is constrained to zero third-party dependencies to prevent build-script execution and network or cache asymmetry.

## Evidence locations

The experiment manifest is `results/001-post-users/generation/b001-gpt-5-6-luna-medium-r20-v2/manifest.json`.
Every run, attempt, diagnostic, candidate snapshot, raw Codex JSONL stream, functional result, and security result is retained below `results/001-post-users/generation/b001-gpt-5-6-luna-medium-r20-v2/`.
The public archive replaces Codex thread identifiers and machine-specific temporary-directory prefixes with neutral placeholders without changing any experimental metric.

The automation uses Codex's documented [non-interactive JSONL mode](https://developers.openai.com/codex/noninteractive), including per-turn usage metadata and resumable threads.
The runner pins its workspace and network permissions through the documented [Codex configuration controls](https://developers.openai.com/codex/config-reference).
The selected model follows the official [GPT-5.6 model guidance](https://developers.openai.com/api/docs/guides/latest-model) for efficient high-volume coding work.
