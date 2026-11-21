# 花信风

**骑上魔毯，沿着二十四节气送一封信。**

《花信风》是一款面向电脑浏览器的中文海岛探索游戏，也是 Qoder 高校创造力大赛作品。你在岛上扮演一名信使，能乘魔毯越过海崖，也能降到港口的屋顶，走进街巷找人。第一份委托是一包春茶，从信使公会送到云雀港的露台茶馆。路怎么走、在哪里落脚，由你决定。

![游戏实机画面：信使在公会与居民交谈](screenshots/desktop-release.jpg)

## 岛上能做什么

- **从空中到街巷。** 借风加速、贴着海面掠行，再挑一处留有净空的屋顶或地面降落。落地后可以步行、奔跑和跳跃，走近居民接单或交货。
- **读一张会留下足迹的航图。** 航图能筛选城镇、停靠平台和探索地点，随你的飞行揭开未探索区域。你可以给地点命名、放置标记、切换追踪目标，下次回来还接得上。
- **看同一座岛过不同的日子。** 从春花、夏绿到秋色、冬雪，二十四节气带来不同的景观与天气。世界时钟从白昼走到夜里，港口窗灯会亮起来。也可以在环境面板手动切换时段、节气和天气。
- **留下一份自己的信使手记。** 送完首单可领一次 30 枚风铃币，旅途中还能收集风之籽与散落在岛上的珍藏。航图、环境和配送进度会保存在当前浏览器。

## 开始游戏

需要 **Python 3** 和支持 **WebGL2** 的现代桌面浏览器。运行游戏无需安装 npm 依赖。

```bash
python3 tools/serve.py 6280
```

打开 [localhost:6280](http://localhost:6280)，等岛屿加载完后点击「乘风而起」。如果画面吃力，可用 [低画质入口](http://localhost:6280/?q=low&dpr=1)。

### 先送完第一单

1. 按 **M** 打开航图，追踪信使公会。
2. 飞到公会屋顶平台附近，双击 **Space** 请求降落。
3. 落稳后走近阿岚，按 **E**，选择「接下春茶订单」。
4. 按 **G** 起飞，跟着航图飞到露台茶馆。
5. 降落后走近老林，按 **E** 确认交货。

### 常用操作

| 按键 | 飞行中 | 地面上 |
| --- | --- | --- |
| W / A / S / D | 俯仰与转向 | 移动 |
| Shift | 加速 | 奔跑 |
| Space | 按住减速，双击请求降落 | 跳跃 |
| G | 尝试在脚下降落 | 起飞 |
| E | — | 交谈、接单与交货 |
| C | 切换四种飞行视角 | — |
| M / J | 航图 / 探索手记 | 航图 / 探索手记 |
| Esc | 释放鼠标或关闭界面 | 释放鼠标或关闭界面 |

## 开发与测试

项目使用原生 JavaScript、Three.js r187、WebGL2 和自定义 GLSL。渲染与世界状态在 `src/core/`，飞行和角色在 `src/player/`，任务与交互在 `src/game/`，环境变化在 `src/seasons/`，航图与界面在 `src/ui/`。

使用 Node.js 24 或更新版本运行本地回归测试：

```bash
node --test src/core/*.test.mjs src/game/*.test.mjs src/seasons/*.test.mjs src/ui/*.test.mjs
```

当前版本包含一条可完整交付的配送任务。存档保存在浏览器本地，换浏览器或访问地址后需要重新开始。世界素材的制作流程见 [城镇制作工具](tools/town/README.md)。

## 许可与素材署名

- 源码版权与许可见 [LICENSE](LICENSE)，渲染依赖许可见 [Three.js 许可](vendor/three/LICENSE)。
- 法师模型与动画来自 KayKit Adventurers，见 [模型许可](assets/models/characters/KayKit-LICENSE.txt)。
- 魔毯模型由 Anna M 创作，许可为 CC BY 3.0，见 [署名与修改记录](assets/models/vehicles/magic-carpet-LICENSE.txt)。
- 居民模型与动画来自 Quaternius，见 [素材记录](assets/models/npcs/SOURCES.txt) 与 [许可](assets/models/npcs/LICENSE-Quaternius.txt)。
- 中文字体使用[霞鹜文楷](https://github.com/lxgw/LxgwWenKai)，采用 SIL Open Font License 1.1。
