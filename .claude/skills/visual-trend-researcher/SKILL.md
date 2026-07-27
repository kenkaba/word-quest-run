---
name: visual-trend-researcher
description: WORD QUEST RUN のビジュアル品質を上げる前に、世界で高評価のスマホゲーム・エンドレスランナー・ファンタジーRPG・学習ゲームの視覚的成功原則を調査し、Visual Benchmark Board を更新する。「見た目が古い/幼稚/安っぽい」「商用品質にしたい」「参考を調べて」と言われたとき、または新しいステージ・キャラクター・演出の制作前に必ず使う。
---

# Visual Trend Researcher

## 目的

特定作品を**コピーしない**。複数作品から**抽象的な成功原則**だけを抽出し、WORD QUEST 独自の方針へ変換できる形で記録する。

## 禁止

- 実在作品のキャラクター、ロゴ、UI、配色そのもの、固有名詞の流用
- 「〇〇風」を目標に据えること（目標は常に「一目で WORD QUEST と分かる」）
- 権利上グレーな素材の取得・同梱

## 手順

1. **現状の直視**：先に自作の最新スクリーンショットを見て、弱点を具体語で書く（「安っぽい」ではなく「影が無く全要素が同一明度」のように）。
2. **調査**：WebSearch で以下の軸を最低3軸調べる。検索語は作品名ではなく**原理**で引く。
   - 例: `atmospheric perspective game background depth layering`
   - 例: `character silhouette readability rim light stylized`
   - 例: `game feel juice camera FOV speed lines animation principles`
   - 例: `stylized mobile game art direction trends`
3. **抽象化**：得た知見を「原則 → WORD QUEST での具体策 → 検証方法」の3点セットに変換する。
4. **記録**：`docs/VISUAL_BENCHMARK_BOARD.md` を更新する。日付と出典URLを必ず残す。

## 分析すべき14項目

起動3秒の第一印象 / カメラ位置と画角 / キャラクターの画面占有率 / 背景の奥行き / 色彩設計 / 光と影 / 情報密度 / 視線誘導 / 質感 / エフェクト / モーション / UIと世界の融合 / SNS動画で映える瞬間 / 継続して見たくなる世界変化

## 出力フォーマット

各項目について:

```
### <項目>
- 業界の原則: <抽象化された原則>
- 現状のWORD QUEST: <具体的な弱点 or 達成済み>
- 採るべき具体策: <実装可能な指示。数値を含める>
- 検証方法: <スクリーンショット/計測でどう確認するか>
- 出典: <URL>
```

## 完了条件

- Benchmark Board に14項目すべてが「具体策と数値」を伴って書かれている
- 出典URLが残っている
- 特定作品名が「参考」としてすら実装指示に混入していない
