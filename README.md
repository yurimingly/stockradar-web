# StockRadar 웹 (아이폰용)

아이폰 사파리에서 열고 공유 버튼 → "홈 화면에 추가"하면 앱처럼 쓸 수 있어요.

- 데이터는 GitHub Actions가 약 20분마다 Yahoo Finance·Google News·CNN에서 받아 `gh-pages` 브랜치에 올려요 (`scripts/fetch.py`).
- 웹앱 코드는 `web/` 폴더. 안드로이드 앱(StockRadar)과 같은 기준을 써요.
