# /// script
# dependencies = []
# ///
"""
Aggregates per-task rewards for the sales-admin dataset.

Reads a JSONL file of per-task reward objects (each with a `pass_rate`
key — see tests/test.sh). Emits:

    {
      "pass_rate": <mean of all tasks>,
      "mean_reward": <same, alias>,
      "n_tasks": <count>
    }
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path


def main(input_path: Path, output_path: Path) -> None:
    rewards: list[float] = []
    for line in input_path.read_text().splitlines():
        if not line.strip():
            continue
        obj = json.loads(line)
        if obj is None:
            rewards.append(0.0)
            continue
        if "pass_rate" in obj:
            rewards.append(float(obj["pass_rate"]))
        elif len(obj) == 1:
            rewards.append(float(next(iter(obj.values()))))
        else:
            raise ValueError(f"unrecognized reward shape: {obj}")

    mean = sum(rewards) / len(rewards) if rewards else 0.0
    output_path.write_text(
        json.dumps({"pass_rate": mean, "mean_reward": mean, "n_tasks": len(rewards)})
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("-i", "--input-path", type=Path, required=True)
    parser.add_argument("-o", "--output-path", type=Path, required=True)
    args = parser.parse_args()
    main(args.input_path, args.output_path)
