# Margo R&D plan

- **Standard:** ASD-STE100 (Simplified Technical English)
- **Status:** Draft 1, 2026-11-28
- **Replaces:** the commercial roadmap direction. The spec `margo_r_d_specification_asd_ste100.md` stays the source for the vocabulary and the research rules (RULE-01 to RULE-07).

## 1. Goal

Margo is a research product. It tests how learning will change in the next ten years. It must make a Learner understand more and remember more than the current method does.

## 2. Thesis

1. Explanations are now cheap. An AI gives a good explanation of any concept in seconds.
2. Two things stay scarce:
   - The Learner's own mental model, made visible and testable.
   - The Learner's initiative to test that model.
3. Each feature must make the **Learner's** model visible. A feature that only shows the **agent's** model is a passive explanation. Section 2 of the spec shows that passive explanations reduce retention.

### 2.1 The test for each feature

Ask: "Does the Learner commit to an answer, a prediction, a sketch or a claim before the system shows its answer?"

- If yes, keep the feature.
- If no, change the feature, or label it as a spike and measure it.

## 3. What is new now (the frontier claim)

Most of the learning science is old: retrieval practice, spacing, contrasting cases and learning by teaching. These capabilities are new since about 2024:

| ID | Capability | Before | Now |
|---|---|---|---|
| F1 | A model of the Learner's mind from natural speech | The system knew only test answers. | The system listens to thoughts during reading and finds gaps without a test. |
| F2 | Unlimited new test items | A human wrote each transfer problem. | The agent writes a new problem for each Node, for each day. |
| F3 | Text that becomes an instrument at read time | The author coded each explorable. | The agent compiles a paragraph into an instrument when the Learner reads it. |
| F4 | Contrasting cases for perception | Film books describe images in words. | The system re-cuts real footage to change one variable. |
| F5 | A synthetic peer | Learning by teaching needed a human. | An agent plays a student with a wrong idea. |
| F6 | One memory across reading and work | Each app forgot the Learner. | One Learner Model follows the Learner into Claude Code. |

**The loop.** Margo closes this loop each day, for one person, at almost zero cost:

> Thought → visible model → challenge → commitment → reveal → delayed test → update

Before now, only a student with a full-time human tutor had this loop (Bloom 1984, "2 sigma"). The frontier claim is true only if the experiment in section 5 shows a gain.

**Not ready yet:**
- F3 generation is slow and sometimes wrong.
- F4 with generated video is not reliable. Video models cannot change one variable and keep all others the same. Re-cutting real footage works today.

## 4. Scope

### 4.1 Domains and benchmark Artifacts

| Domain | Knowledge type | Benchmark Artifact | Explorable form |
|---|---|---|---|
| LLMs | Mechanism | Sebastian Raschka, *Build a Large Language Model (From Scratch)* | A running model: tokenizer, attention, sampling temperature |
| Filmmaking | Perception and taste | Walter Murch, *In the Blink of an Eye* | Footage: move a cut, change the shot length, compare two edits |

Two different knowledge types make the comparison stronger. Filmmaking needs clips. **Open item:** decide the clip source (the Learner's own footage or public clips).

### 4.2 Learner

The design target is any Learner. The first test subject is one Learner (n = 1). Do not claim statistical power. Use the within-subject design in section 5.

## 5. Experiment design

### 5.1 Arms

- **Baseline arm:** the current method. Read, highlight, ask Claude in chat.
- **Margo arm:** the Margo features in section 6.

Split the chapters of each benchmark Artifact between the two arms. Alternate the chapters (A, B, A, B), so both arms get the same weeks, mood and sleep.

### 5.2 Test days

Use **day 14** as the decision point. Use day 2 and day 7 as early signals.

Reasons:
- Most forgetting happens in the first week. Day 14 is past the steep part of the forgetting curve, so it shows real retention.
- Day 30 doubles the time for each cycle. For a research product, cycle speed is important.
- Day 2 and day 7 show the trend early, so we can stop a failed feature sooner.
- Later, run day 30 on a sample of Nodes to confirm that the day-14 result holds.

### 5.3 What to measure

| Measure | Example (LLMs) | Example (film) |
|---|---|---|
| **Recall** (secondary) | "What does attention compute?" | "What is a cut on action?" |
| **Transfer** (primary) | "The model loses a name 2,000 tokens back. Why?" | "Here is a new scene. Why does this cut feel wrong?" |

- Generate the transfer items with the agent (F2). Check each item with `verify_item` before use.
- The Learner does not see the transfer items before the test day.
- Grade on a 3-tier scale (pass, partial, fail), per RULE-06. The Learner can overrule a grade.

### 5.4 Kill rule

Write the margin down before the first test. The proposed margin is **20 points** on day-14 transfer accuracy.

- If the Margo arm does not beat the baseline arm by the margin, in both domains, stop or change direction.
- Do not change the margin after the tests start.

## 6. Features

### 6.1 Natural voice (done in this draft)

- Read-aloud uses **Kokoro 82M** (v1.0), through sherpa-onnx, on the Learner's machine. The book text does not leave the machine.
- The model downloads once, when the Learner asks (about 350 MB).
- There are **3 voice presets** only: Heart (US), Michael (US), Emma (UK). Fewer options means a faster choice.
- Kokoro gives no word timings. The word highlight moves at the rate of the characters in each sentence. It is close, not exact.
- sherpa-onnx 2 reads words only through a lexicon (178,000 English words). It skips a word that is not in the lexicon, with no error. `lib/server/voice-text.cjs` changes these words before synthesis:
  - Numbers become words ("1995" becomes "nineteen ninety five").
  - Acronyms are spelled ("GPT" becomes "g p t").
  - New words are split into known words ("softmax" becomes "soft max"), or read as a known stem plus an ending ("tokenizer" becomes "tokenize er").
- **Measured (M-series Mac, 4 threads):** Kokoro makes speech at about 0.3 times real time (8.9 s of audio in 2.7 s). The next sentence is ready before the current sentence ends.
- **Next:** a cloud speech-to-speech voice, behind the same interface, for the Stubborn Junior debates (F5). Decide first whether the Learner's own speech can go to the cloud.

### 6.2 Hover glance (spike, done in this draft)

- **Trigger:** hold Option and rest the pointer on a word for 350 ms. Release Option to close the card.
- **Card:** the meaning of the word in its sentence, one example, and a flag that tells if the passage teaches this idea.
- **Why Option:** a plain hover sends a model call on each pointer stop. That breaks RULE-05 (calm default). To test plain hover, remove the `altKey` check in `EpubReader.tsx`.
- **Log:** each glance goes to `glances.jsonl` in the data folder (term, core flag, time).
- **Measured:** one glance through the Claude Code CLI took 4.3 s. This is too slow for a hover. **Next:** send glances to the fastest model (Haiku), per the spec routing table (UI copy row), and pre-fetch the term under the pointer when Option goes down.
- **Measure:** day-7 recall on Nodes the Learner glanced at, against Nodes the Learner did not glance at. Compare core terms and prerequisite terms separately.
- **Kill rule:** if day-7 recall on glanced core terms is lower than on non-glanced core terms, remove the glance from core terms. Keep it for prerequisite terms.

### 6.3 Thought stream (next)

1. The Learner holds a key and speaks a thought. Speech-to-text runs locally (Parakeet).
2. The system does not answer at once.
3. The agent sorts the thought: question, hypothesis, objection, connection or confusion.
4. The agent pins the thought to the passage and to the board. Use `park_question` for questions.
5. **Blocking** question ("I cannot follow the next paragraph"): give the smallest hint at once (RULE-02).
6. **Curiosity** question: park it.
7. At the end of the chapter, parked thoughts return as challenges: "You asked X. Predict one difference, then see."

### 6.4 Boards as the Learner's model (next)

- The Learner draws nodes and arrows.
- The agent does not draw the model. The agent attacks it: an arrow that the book contradicts, a missing node, a consequence to predict.
- Save a board snapshot each session. The change in the board over time is a second measure of understanding.

### 6.5 Explorables (next)

- Use a fixed set of 6 to 10 instruments (option B in the spec, section 7). The model selects the instrument and fills its data. This matches the AI SDK generative UI pattern: typed tools map to fixed components.
- Each instrument asks for a commitment first:
  - LLMs: "Sketch output diversity for temperature 0 to 2." Then run a small model and show both curves.
  - Film: "Mark the frame where you would cut." Then show the editor's cut and two other cuts.
- Do not generate unconstrained UI for each request. A Learner gets skilled with tools that stay the same.

### 6.6 Dual-Model Judge (later)

- Two models answer the same question. One model gets a hidden prompt to add one subtle flaw.
- The Learner finds the flawed argument.
- The planted flaw gives exact ground truth, so the score is reliable.

### 6.7 Stubborn Junior (later)

- The agent plays a junior who holds a confident misconception about a Node.
- The agent concedes only when the Learner's explanation removes the false premise.
- **Risk:** the agent concedes too easily, or argues pedantically (spec EXP-03).

### 6.8 In-flow checks through MCP (later)

- See spec section 5.3. Margo logs concepts the Learner gives to Claude Code. At a breakpoint, Margo asks one 15-second question.

## 7. Phases

| Phase | Work | Exit check |
|---|---|---|
| 0 | Voice (Kokoro, 3 presets). Hover spike. Rename to Margo. | Kokoro speaks a chapter. The glance card opens on Option + hover. |
| 1 | Thought stream. Generate transfer items. Set up the split chapters. | Day-2 test runs for chapters 1 and 2 of each book. |
| 2 | Board attacks. 3 explorable instruments for each domain. | Day-7 signal for both arms. |
| 3 | Dual-Model Judge. Stubborn Junior with voice. | Day-14 decision against the kill rule. |
| 4 | In-flow MCP checks. Day-30 confirmation sample. | Write up the result, then decide the next direction. |

## 8. Open items

1. The clip source for the film domain.
2. The cloud voice rule for the Learner's own speech.
3. The final value of the kill margin (proposed: 20 points).
4. Memory coupling: does a broken explorable create an FSRS review Node? (spec section 7, item 3). Proposed: no, by default. Create a Node only when the Learner's prediction was wrong.
