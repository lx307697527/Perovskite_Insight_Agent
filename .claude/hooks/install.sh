#!/bin/bash
# PIA Git Hooks 安装脚本 (Bash)

echo "🔧 PIA Git Hooks 安装"
echo ""

HOOKS_DIR=".claude/hooks"
GIT_HOOKS_DIR=".git/hooks"

# 检查 Git 仓库
if [ ! -d ".git" ]; then
    echo "❌ 错误: 当前目录不是 Git 仓库根目录"
    exit 1
fi

# 确保 .git/hooks 目录存在
mkdir -p "$GIT_HOOKS_DIR"

# 安装 hooks
HOOKS=("post-commit" "pre-push" "prepare-commit-msg")

for hook in "${HOOKS[@]}"; do
    source="$HOOKS_DIR/$hook"
    target="$GIT_HOOKS_DIR/$hook"

    if [ -f "$source" ]; then
        cp "$source" "$target"
        chmod +x "$target"
        echo "✅ 已安装: $hook"
    else
        echo "⚠️  跳过: $hook (源文件不存在)"
    fi
done

echo ""
echo "🎉 Git Hooks 安装完成!"
echo ""
echo "已安装的 Hooks:"
echo "  - post-commit       : 自动记录提交到 SESSION.md"
echo "  - pre-push          : 推送前检查 Memory 更新"
echo "  - prepare-commit-msg: 提交信息规范模板"
