#!/usr/bin/env python3
"""Generate the current fork path ownership inventory from Git refs."""

from __future__ import annotations

import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
UPSTREAM_FIX_DISPOSITIONS_PATH = ROOT / "fork-features" / "upstream-fix-dispositions.tsv"
CLOSING_PR_PATHS = {
    "fork-features/generate-ownership.py",
    "fork-features/ownership.tsv",
    "fork-features/trunk-patches.md",
    "hub/src/store/index.ts",
}


def git(*args: str) -> str:
    return subprocess.check_output(["git", "-C", str(ROOT), *args], text=True)


COMMIT_OWNERS: dict[str, str] = {
    # Session fork / rewind
    **{commit: "#170" for commit in (
        "ae9f932a", "d1373a53", "92fa6ad3", "e009becc", "fc377386",
        "837647b2", "dc36d46e", "ff574b67", "fbfd26f5", "2939fcc6",
        "253e5184", "5262a261", "d5b095d1", "11c9a08a", "4bbe2a18",
        "f4ef5a48", "9e867c21", "dec48514", "7dca6478", "aee648ee",
        "f8b27e3a", "bf1a6b9a", "2ef4c618", "f3c58338", "a0c02d7f",
        "d840284a", "ddf6df18", "61d4f0c3", "e1611788", "206da967",
        "a1a7d0aa", "752c3147", "7c0cb8d9", "4fbe9567", "4ffb89d7",
        "165ae59d", "2138d84b", "ddd6927a", "cea30319", "17e79d08",
    )},
    # Multi-user gateway
    **{commit: "#171" for commit in (
        "a6f9e3f9", "b3922ef4", "d36af3c5", "8cae045d", "ba37bcfb", "7e004cc7",
    )},
    # OMP flavor
    "3686370a": "#172", "7e0010b8": "#172",
    # cc-switch / OpenUsage
    **{commit: "#173" for commit in (
        "a8815d47", "fc7d7b4a", "3994ee9a", "faec872c", "9e76994b",
        "92e8a6e1", "78f3ffef", "51929072", "44f2bce5", "8d828436",
    )},
    # Claude custom model / resume
    **{commit: "#174" for commit in (
        "7e3edb0f", "413e76cc", "bec12318", "606c6579", "8240268f",
        "6ba438a1", "8a621492",
    )},
    # Inline media
    "d28853c7": "#175", "72c96399": "#175",
    # Generated files
    "b4c31e88": "#176", "3edb7db8": "#176",
    # Workspace files
    **{commit: "#177" for commit in (
        "c853bcbf", "bfa252da", "d3199037", "e737b4b3", "f00c8228", "e2a200a8",
    )},
    # Long content collapse
    "302180e5": "#178",
    # Task panel
    "85743eb7": "#181",
}


PATH_OWNER_OVERRIDES: tuple[tuple[str, str], ...] = (
    ("fork-features/generate-ownership.py", "#169"),
    ("fork-features/ownership.tsv", "#169"),
    ("hub/src/store/index.ts", "#174"),
    ("cli/src/claude/claudeRemote.ts", "#170"),
    ("cli/src/claude/sdk/query", "#170"),
    ("cli/src/claude/sdk/types.ts", "#170"),
    ("cli/src/claude/session.ts", "#170"),
    ("cli/src/claude/types.ts", "#170"),
    ("cli/src/claude/utils/sdkToLogConverter", "#170"),
    ("cli/src/codex/appServerTypes.ts", "#170"),
    ("cli/src/codex/codexAppServerClient.ts", "#170"),
    ("cli/src/index.ts", "#170"),
    ("cli/src/runner/buildCliArgs.test.ts", "#170"),
    ("cli/tsconfig.json", "#170"),
    ("hub/src/store/sessions", "#170"),
    ("shared/src/rpcMethods.ts", "#170"),
    ("shared/src/schemas.ts", "#170"),
    ("shared/src/types.ts", "#170"),
    ("web/src/components/SessionActionMenu.tsx", "#170"),
    ("web/src/components/SessionHeader.tsx", "#170"),
    ("web/src/components/SessionList.tsx", "#170"),
    ("web/src/hooks/mutations/useSessionActions", "#170"),
    ("web/src/hooks/useComposerDraft.ts", "#170"),
    ("fork-features/session-fork/", "#170"),
    ("fork-features/multi-user/", "#171"),
    ("web/src/fork-features/multi-user/", "#171"),
    ("cli/src/omp/", "#172"),
    ("cli/src/commands/omp.ts", "#172"),
    ("cli/src/modules/common/usage/", "#173"),
    ("web/src/lib/generatedInlineMedia", "#175"),
    ("cli/src/modules/common/generatedImages", "#175"),
    ("cli/src/modules/common/generatedFiles", "#176"),
    ("web/src/components/AssistantChat/messages/GeneratedFileCard", "#176"),
    ("web/src/components/CollapsibleContent", "#178"),
    ("web/src/components/AssistantChat/TodoPanel", "#181"),
    ("hub/src/sync/todos", "#181"),
)


def owner_for(path: str, commits: list[str]) -> str:
    for prefix, owner in PATH_OWNER_OVERRIDES:
        if path.startswith(prefix):
            return owner
    for commit in commits:  # git log order: newest first
        owner = COMMIT_OWNERS.get(commit)
        if owner is not None:
            return owner
    return "#179"


def exists(ref: str, path: str) -> bool:
    return subprocess.run(
        ["git", "-C", str(ROOT), "cat-file", "-e", f"{ref}:{path}"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    ).returncode == 0


def load_upstream_fix_dispositions() -> dict[str, tuple[str, str, str]]:
    lines = UPSTREAM_FIX_DISPOSITIONS_PATH.read_text().splitlines()
    if not lines or lines[0] != "path\tdisposition\treference\trationale":
        raise ValueError("invalid upstream fix disposition header")

    dispositions: dict[str, tuple[str, str, str]] = {}
    for line in lines[1:]:
        path, disposition, reference, rationale = line.split("\t", 3)
        if disposition not in {"fork-specific", "upstream-issue"}:
            raise ValueError(f"invalid upstream fix disposition for {path}: {disposition}")
        if path in dispositions:
            raise ValueError(f"duplicate upstream fix disposition: {path}")
        dispositions[path] = (disposition, reference, rationale)
    return dispositions


def main() -> None:
    target = "HEAD"
    diff_paths = sorted(git("diff", "--name-only", "upstream/main", target).splitlines())
    base = git("merge-base", "upstream/main", target).strip()
    upstream_changed = set(git("diff", "--name-only", base, "upstream/main").splitlines())
    origin_changed = set(git("diff", "--name-only", base, target).splitlines())
    upstream_fix_dispositions = load_upstream_fix_dispositions()
    consumed_upstream_fix_dispositions: set[str] = set()

    rows: list[str] = []
    for path in diff_paths:
        disposition_evidence: tuple[str, str, str] | None = None
        fork_log = git(
            "log", "--no-merges", "--format=%h", f"upstream/main..{target}", "--", path
        ).splitlines()

        if path in CLOSING_PR_PATHS:
            if path in {"fork-features/generate-ownership.py", "fork-features/ownership.tsv"}:
                classification = "fork-owned"
                owner = "#169"
                evidence = "#169 closing PR inventory implementation"
            elif path == "fork-features/trunk-patches.md":
                classification = "fork-owned"
                owner = "#171"
                evidence = "fork trunk-patch registry; updated by boundary children"
            else:
                classification = "trunk-patch"
                owner = "#174"
                evidence = "#170 removed unused helper; remaining persisted-session hook closed by #174"
        elif path in upstream_changed and path not in origin_changed:
            classification = "upstream-sync"
            owner = "#180"
            evidence = f"merge-base {base[:8]}; changed only on upstream/main"
        else:
            owner = owner_for(path, fork_log)
            if not exists("upstream/main", path) and exists(target, path):
                classification = "fork-owned"
            elif owner in {"#170", "#171", "#172", "#173", "#174", "#175", "#176", "#177", "#178"}:
                classification = "trunk-patch"
            elif owner == "#179":
                disposition = upstream_fix_dispositions.get(path)
                if disposition is None:
                    raise ValueError(f"missing upstream fix disposition: {path}")
                disposition_kind, reference, rationale = disposition
                disposition_evidence = disposition
                consumed_upstream_fix_dispositions.add(path)
                classification = "trunk-patch" if disposition_kind == "fork-specific" else "upstream-fix"
            else:
                classification = "open-child"
            commits = ",".join(fork_log) if fork_log else "merge-resolution"
            side = "both refs changed" if path in upstream_changed else "origin-only delta"
            evidence = f"{side}; fork commits {commits}"
            if disposition_evidence is not None:
                disposition_kind, reference, rationale = disposition_evidence
                evidence += f"; disposition {disposition_kind} {reference}: {rationale}"

        rows.append("\t".join((path, classification, owner, evidence)))

    orphan_dispositions = sorted(
        set(upstream_fix_dispositions) - consumed_upstream_fix_dispositions
    )
    if orphan_dispositions:
        raise ValueError(
            "orphan upstream fix dispositions: " + ", ".join(orphan_dispositions)
        )

    output = ROOT / "fork-features" / "ownership.tsv"
    output.write_text("\n".join(rows) + "\n")


if __name__ == "__main__":
    main()
