# 升级 design-guide

Git 安装方式：

```bash
git pull --ff-only
```

然后同步并检查所有 AIDE 镜像：

```bash
bash scripts/sync-aide.sh
python3 scripts/design-guide-doctor.py --strict
```

本地偏好仍保存在 `.design-guide/profile.md` 和 `~/.design-guide/preferences.md`，不会被公开源覆盖。升级后如果 AIDE 缓存了 skill 发现结果，请重启或重新加载 AIDE。
