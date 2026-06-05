default:
    @just --list

# Show commits since the last release tag
unreleased:
    #!/usr/bin/env sh
    last=$(git describe --tags --abbrev=0 2>/dev/null)
    if [ -z "$last" ]; then echo "No tags yet."; exit 0; fi
    n=$(git rev-list --count "$last"..HEAD)
    if [ "$n" -eq 0 ]; then
        echo "Up to date — HEAD is $last, nothing unreleased."
    else
        echo "$n commit(s) since $last:"
        git log --oneline "$last"..HEAD
        echo
        echo "Tag a release? -> just release X.Y.Z \"Title\""
    fi

# Cut a release: tag (annotated), push it, create the GitHub Release
release version title="":
    #!/usr/bin/env sh
    set -e
    v="{{version}}"
    case "$v" in v*) ;; *) v="v$v" ;; esac
    t="{{title}}"; [ -n "$t" ] || t="$v"
    git tag -a "$v" -m "$t"
    git push origin "$v"
    gh release create "$v" --title "$v — $t" --generate-notes --latest
    echo "Released $v"

# Deploy to prod: pull latest on ams and restart the gateway
deploy:
    @just unreleased
    @echo
    @echo "Deploying to ams..."
    ssh ams 'cd ~/code/aihub && git pull origin main && pnpm install && pnpm build && pnpm build:web && aihub gateway restart'
