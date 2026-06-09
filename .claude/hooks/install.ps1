# PIA Git Hooks 安装脚本 (Windows PowerShell)

Write-Host "🔧 PIA Git Hooks 安装" -ForegroundColor Cyan
Write-Host ""

$hooksDir = ".claude\hooks"
$gitHooksDir = ".git\hooks"

# 检查 Git 仓库
if (-not (Test-Path ".git")) {
    Write-Host "❌ 错误: 当前目录不是 Git 仓库根目录" -ForegroundColor Red
    exit 1
}

# 确保 .git/hooks 目录存在
if (-not (Test-Path $gitHooksDir)) {
    New-Item -ItemType Directory -Path $gitHooksDir -Force | Out-Null
}

# 安装 hooks
$hooks = @("post-commit", "pre-push", "prepare-commit-msg")

foreach ($hook in $hooks) {
    $source = Join-Path $hooksDir $hook
    $target = Join-Path $gitHooksDir $hook

    if (Test-Path $source) {
        Copy-Item $source $target -Force
        Write-Host "✅ 已安装: $hook" -ForegroundColor Green
    } else {
        Write-Host "⚠️  跳过: $hook (源文件不存在)" -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "🎉 Git Hooks 安装完成!" -ForegroundColor Green
Write-Host ""
Write-Host "已安装的 Hooks:" -ForegroundColor Cyan
Write-Host "  - post-commit       : 自动记录提交到 SESSION.md"
Write-Host "  - pre-push          : 推送前检查 Memory 更新"
Write-Host "  - prepare-commit-msg: 提交信息规范模板"
