<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#101923">
  <title>Drawn Frontier</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <main class="game-shell" aria-label="도트 개척 게임">
    <p id="game-instructions" class="sr-only">WASD로 이동하고 Shift로 달립니다. 방향키로 도구를 휘두르며, Space로 도구를 땅에 고정합니다. Tab은 도구 팔레트, Q와 E는 관절 고정과 회수, R은 캠프에서 도구 다시 그리기입니다. Escape로 일시 정지합니다.</p>
    <canvas id="game" width="384" height="216" tabindex="0" aria-label="Drawn Frontier 게임 화면" aria-describedby="game-instructions"></canvas>
  </main>
  <script src="game.js"></script>
</body>
</html>
