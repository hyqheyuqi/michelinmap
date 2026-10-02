# 米其林城市地图

一个无需构建即可运行的全球米其林餐厅交互地图，收录必比登、1 星、2 星和 3 星餐厅。地图先按区域聚合城市，再逐级进入城市与街道尺度，避免在全球视图中同时绘制数千个餐厅图钉。

![MapLibre](https://img.shields.io/badge/MapLibre-GL_JS-396CB2)
![Data](https://img.shields.io/badge/data-7%2C633_restaurants-9F1F2D)
![Build](https://img.shields.io/badge/build-none-5C7C4D)

## 功能

- 全球、区域、城市、街道四级地图下钻
- 城市聚类，以及语义化的 `＋` / `−` 层级控制
- 触控板缩小手势快速返回上一层
- 按必比登与星级、价格等级、菜系关键词筛选
- 搜索国家、城市和餐厅名称
- 城市餐厅列表、地址、菜系、价格符号和米其林来源页面
- 纯静态文件，可直接部署到 GitHub Pages

## 本地运行

项目没有安装或构建步骤。在仓库目录启动静态服务器：

```bash
python3 -m http.server 4173
```

打开 <http://localhost:4173>。不要直接双击 `index.html`，浏览器的本地文件安全策略可能阻止读取 `data/` 中的 JSON 和 GeoJSON。

## 部署到 GitHub Pages

1. 将仓库推送到 GitHub。
2. 打开仓库的 **Settings → Pages**。
3. 在 **Build and deployment** 中选择 **Deploy from a branch**。
4. 选择发布分支（通常为 `main`）和根目录 `/`，保存即可。

页面使用相对路径读取数据，因此不需要为项目子路径修改代码。MapLibre GL JS 由 unpkg CDN 加载，底图使用 OpenStreetMap 公共瓦片；正式或高流量部署前应更换为符合使用量与服务条款的瓦片服务。

## 数据文件

| 文件 | 用途 |
| --- | --- |
| `data/restaurants.csv` | 一行一家餐厅的完整表格数据 |
| `data/restaurants.geojson` | 带坐标的餐厅地图数据 |
| `data/cities.geojson` | 城市节点与城市级奖项统计 |
| `data/city-restaurants.json` | 按城市分组的网页详情数据 |
| `data/country-summary.csv` | 国家与荣誉汇总 |
| `data/quality-report.json` | 数据数量及缺失字段报告 |

主要字段包括餐厅名称、国家、地区、城市、详细地址、菜系、荣誉、价格符号、经纬度、来源页面和快照日期。字段定义与更完整的来源说明见 [`data/SOURCE.md`](data/SOURCE.md)。

## 数据来源与限制

当前快照来自 Jerry Ng 的 MIT 许可项目 [michelin-my-maps](https://github.com/ngshiheng/michelin-my-maps)，其数据整理自米其林指南；本项目没有运行米其林官网爬虫。上游快照日期为 2026-09-04。

当前数据包含 7,633 家餐厅：必比登 3,743 家、1 星 3,181 家、2 星 547 家、3 星 162 家。它是一个时间点快照，并非米其林官方或实时名单，可能因撤榜、升降级、关店和更新时间不同而与官网存在差异。

米其林名称、评级及相关商标属于其权利人。本项目是独立的地图展示实验，与米其林无隶属或背书关系。公开发布或商业使用前，请自行确认数据许可、数据库权利、商标规范以及目标司法辖区的要求。

## 重建数据

```bash
python3 scripts/build_dataset.py /path/to/michelin_my_maps.csv \
  --output-dir data \
  --snapshot-date 2026-09-04
```

## 技术结构

- `index.html`：页面结构与筛选控件
- `styles.css`：响应式玻璃质感界面
- `app.js`：MapLibre 图层、四级导航、筛选和搜索
- `scripts/build_dataset.py`：数据标准化与派生文件生成

## 许可

本项目的原创代码使用 [PolyForm Noncommercial License 1.0.0](LICENSE)，版权归 `hyqheyuqi` 所有。允许个人学习、研究、实验以及符合许可证定义的非商业组织使用、修改和分发；商业使用未获授权。

PolyForm Noncommercial License **不适用于** `data/` 目录中的第三方餐厅数据、米其林名称与评级、第三方商标、OpenStreetMap 数据或其他第三方材料。这些内容仍分别受其原始许可、使用条款及适用法律约束，详见 [`NOTICE.md`](NOTICE.md) 与 [`data/SOURCE.md`](data/SOURCE.md)。
