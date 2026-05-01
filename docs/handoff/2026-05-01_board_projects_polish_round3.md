# Board Projects Polish Round 3

Board tab switching now keeps Overview and Projects panels mounted, hiding inactive panels with CSS so switching is DOM-only. Board project worktree discovery now supports explicit README frontmatter associations for ad-hoc repo worktrees that do not use `space/PRO-*` branch naming.

Use `worktrees: [{"repo":"~/code/aihub","branch":"feat/example"}]` or string paths in project README frontmatter when a plain git worktree cannot be inferred from the project ID.
