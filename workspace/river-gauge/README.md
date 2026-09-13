# river-gauge 巡河记录

三个人轮流跑同一条河，记录全进一个库，不再对本子。

- 到断面**先选编号**，抄水位标尺、水色、目估流速
- 在**本地河道简图**上点位置，标漂浮物 / 疑似排污口，写一句话备注，可传现场照片（照片进服务器目录，不再夹包里）
- 按**日期 + 断面**回看；录错的水位、水色、流速、备注、巡测时间可以直接修改，修改人留痕
- 错条可以**整条作废并填写原因**；作废记录保留在历史里，但不参与“相邻两次”和跳变清单
- 同一断面**相邻两次有效水位差 > 30cm 自动挑出**（差正好 30cm 不算；跳变清单），追问是不是抄串了，问完标“已核实”
- 新增、修改时间/水位、作废或恢复导致相邻配对变化时，相关记录的旧“已核实”自动回到待追问
- 修改、作废、恢复都进操作流水，三班次能看到谁动过、旧值是什么、为什么作废
- 简图坐标全在自己库的 `sketch_features` / `sections` 表里，纯 SVG 渲染，**不接任何在线地图**

## 目录

```
river-gauge/
├── docker-compose.yml   # 一键起：db + section-svc + gateway(Nginx)
├── db/init.sql          # 建表 + 断面/简图种子数据（只首次执行）
├── nginx/               # 网关：页面静态文件 + /api、/uploads 反代到同一端口
├── section-svc/         # Node 汇总接口（Express + MySQL）
└── walk-pad/            # React 巡测页（Vite 构建）
```

## 跑起来（站里电脑）

```bash
cd river-gauge
docker compose up -d --build
```

浏览器开 `http://localhost:8081`；另外两个人开 `http://<这台电脑的IP>:8081`。

改端口 / 数据库密码：启动前设环境变量，如

```bash
WEB_PORT=9000 DB_ROOT_PASSWORD=你的密码 docker compose up -d --build
```

## 日常使用

1. **巡测记录**：选断面编号 → 抄水位/水色/流速 → 保存读数 → 在简图上点位置标漂浮物或疑似排污口（可拍照上传）。点简图上的断面圆圈也能选编号。
2. **历史回看**：按日期、断面翻记录；每条有效读数自动带“较前次 ±多少米”。填“本次操作人”后可修改抄录内容，或把错条作废；点“看操作记录”可查旧值、作废原因和操作人。
3. **跳变清单**：只按有效记录计算相邻差。作废条会被跳过，前一条有效读数自动接到后一条；超 30cm 的挨个追问，问清了点“标记已核实”。如果之后补录、改时间/水位、作废或恢复导致配对变化，相关旧核实会自动清掉，重新追问。

## 数据

- MySQL 数据在卷 `db-data`，照片在卷 `uploads`，`docker compose down` 不会丢；`down -v` 才会清空。
- 备份：
  ```bash
  docker compose exec db mysqldump -uroot -p river_gauge > backup.sql
  docker run --rm -v river-gauge_uploads:/v alpine tar czf - -C /v . > uploads.tar.gz
  ```

## 断面 / 简图怎么改

断面和简图都在库里，改 `db/init.sql` 的种子只对全新部署生效；已跑起来的库直接 SQL 改：

```sql
-- 加一个断面（坐标是简图坐标系 0~1000 × 0~620）
INSERT INTO sections (code, name, x, y, sort) VALUES ('RG-05', '入河口', 950, 424, 5);
-- 加一段岸线
INSERT INTO sketch_features (ftype, label, points) VALUES ('bank', '滩地', '[[100,240],[250,250]]');
```

## 本机开发（不套 Docker）

```bash
# 终端1：接口（需要一个本地 MySQL，导入 db/init.sql）
cd section-svc && DB_HOST=127.0.0.1 DB_PASSWORD=xxx npm install && npm run dev
# 终端2：页面（/api、/uploads 已代理到 3000）
cd walk-pad && npm install && npm run dev
```
