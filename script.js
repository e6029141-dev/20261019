const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const mathUI = document.getElementById('math-ui');
const questionText = document.getElementById('question-text');
const answerInput = document.getElementById('answer-input');
const feedbackText = document.getElementById('feedback-text');
const menuUI = document.getElementById('menu-ui');

let cw = canvas.width = window.innerWidth;
let ch = canvas.height = window.innerHeight;

// ゲームの状態管理 ('MENU', 'PLAYING', 'MATH_MODE', 'LASER_FIRING', 'GAME_OVER', 'STAGE_CLEAR')
let gameState = 'MENU';

// プレイヤー・ゲーム進行の変数
let playerLives = 3;
const TIME_LIMIT = 6 * 60; // 6秒 (60fps想定 = 360フレーム)
let phaseTimer = 0;        // 現在のフェーズの残り時間
let screenFlashTimer = 0;  // ダメージ時の画面フラッシュエフェクト用

// ステージ進行用の変数
let currentStage = 1;      // 1〜9: 各段, 10: ぜんぶの段
let maxUnlockedStage = 1;  // 解放されている最大のステージ
let enemiesDefeated = 0;   // 倒した敵の数

// プレイヤー情報
const player = {
    x: cw / 2,
    y: ch - 100,
    size: 30,
    color: '#3b82f6'
};

let isDragging = false; // 自機を操作（タッチ）しているかどうかのフラグ

// 弾と敵の配列
let bullets = [];
let enemies = [];
let particles = [];

// 背景の星データ
let stars = Array.from({length: 100}, () => ({
    x: Math.random() * cw,
    y: Math.random() * ch,
    size: Math.random() * 2 + 0.5,
    speed: Math.random() * 3 + 1
}));

// かけ算問題のデータ
let currentQuestion = { a: 0, b: 0, answer: 0 };
let currentInputStr = "";

// --- サウンド設定 (Tone.js) ---
let isBgmPlaying = false;
let bgmSynth;
let sequence;

function startBGM() {
    if (isBgmPlaying) return;
    isBgmPlaying = true;
    
    bgmSynth = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: "sawtooth" },
        envelope: { attack: 0.05, decay: 0.1, sustain: 0.2, release: 1 }
    }).toDestination();
    bgmSynth.volume.value = -28; // さらに音量を小さめに調整

    // 簡単なテクノ風ベースライン
    const notes = ["C3", ["C3", "G3"], "Eb3", "F3", "C3", ["C3", "Bb2"], "G2", "Bb2"];
    sequence = new Tone.Sequence((time, note) => {
        bgmSynth.triggerAttackRelease(note, "8n", time);
    }, notes, "8n");
    
    Tone.Transport.bpm.value = 130;
    Tone.Transport.start();
    sequence.start(0);
}

function playShootSound() {
    if(Tone.context.state !== 'running') return;
    const synth = new Tone.MembraneSynth().toDestination();
    synth.volume.value = -15;
    synth.triggerAttackRelease("C4", "32n");
}

function playExplosionSound(isBig = false) {
    if(Tone.context.state !== 'running') return;
    const synth = new Tone.NoiseSynth({
        noise: { type: 'white' },
        envelope: { attack: 0.01, decay: isBig ? 0.8 : 0.3, sustain: 0 }
    }).toDestination();
    synth.volume.value = isBig ? -5 : -15;
    synth.triggerAttackRelease(isBig ? "4n" : "16n");
}

function playDamageSound() {
    if(Tone.context.state !== 'running') return;
    const synth = new Tone.Synth({
        oscillator: { type: "sawtooth" },
        envelope: { attack: 0.01, decay: 0.2, sustain: 0.0, release: 0.2 }
    }).toDestination();
    synth.volume.value = -10;
    // ブブッという警告音のような2連音
    synth.triggerAttackRelease("G2", "8n");
    setTimeout(() => {
        synth.triggerAttackRelease("E2", "4n");
    }, 150);
}

function playLaserSound() {
    if(Tone.context.state !== 'running') return;
    const synth = new Tone.Synth({
        oscillator: { type: "triangle" },
        envelope: { attack: 0.1, decay: 0.2, sustain: 1.0, release: 0.5 }
    }).toDestination();
    synth.volume.value = -10;
    synth.triggerAttackRelease("C5", "2n");
    synth.frequency.rampTo("C3", 0.5);
}
// --- サウンド設定ここまで ---

// プレイヤーの操作開始（マウス＆タッチ）
async function handleStart(e) {
    // ユーザー操作時にAudio初期化とBGM再生
    if (typeof Tone !== 'undefined') {
        if (Tone.context.state !== 'running') {
            await Tone.start();
        }
    }

    // メニュー画面では操作しない
    if (gameState === 'MENU') return;

    if (gameState === 'GAME_OVER' || gameState === 'STAGE_CLEAR') {
        // リザルト画面からはメニューに戻るように変更
        backToMenu();
        return;
    }

    if (gameState !== 'PLAYING') return;
    let clientX = e.touches ? e.touches[0].clientX : e.clientX;
    let clientY = e.touches ? e.touches[0].clientY : e.clientY;
    
    // タッチした場所が自機の近くか判定（指で触りやすいように少し広めの判定）
    let dist = Math.hypot(player.x - clientX, player.y - (clientY - 50)); 
    if (dist < 100) { 
        isDragging = true;
        movePlayer(e);
    }
}

// 操作終了
function handleEnd() {
    isDragging = false;
}

// プレイヤーの移動
function movePlayer(e) {
    if (gameState !== 'PLAYING' || !isDragging) return; // ドラッグ中のみ動く
    if (e.cancelable) e.preventDefault(); // スマホでの画面スクロールを防止
    
    let clientX = e.touches ? e.touches[0].clientX : e.clientX;
    let clientY = e.touches ? e.touches[0].clientY : e.clientY;
    player.x = clientX;
    player.y = clientY - 50; // 指で隠れないように少し上にズラす

    // 画面外に出ないように制限
    player.x = Math.max(player.size, Math.min(cw - player.size, player.x));
    player.y = Math.max(player.size, Math.min(ch - player.size, player.y));
}

// 以前の movePlayer のイベントリスナーを削除し、新しいものを登録
window.addEventListener('mousedown', handleStart);
window.addEventListener('touchstart', handleStart, {passive: false});
window.addEventListener('mouseup', handleEnd);
window.addEventListener('touchend', handleEnd);
window.addEventListener('mousemove', movePlayer);
window.addEventListener('touchmove', movePlayer, {passive: false});

// 自動射撃タイマー
setInterval(() => {
    // isDragging (自機を触っている間) だけ弾を発射する
    if (gameState === 'PLAYING' && enemies.length > 0 && isDragging) {
        bullets.push({
            x: player.x,
            y: player.y - player.size/2,
            vy: -10,
            radius: 5,
            type: 'normal'
        });
        playShootSound(); // 発射音
    }
}, 150); // 0.15秒に1発

// 敵を定期的に出現
setInterval(() => {
    if (gameState === 'PLAYING' && enemies.length < 1) {
        enemies.push({
            x: Math.random() * (cw - 120) + 60, // ランダムなX座標に出現
            y: -50,
            tx: Math.random() * (cw - 120) + 60, // 目標X座標
            ty: Math.random() * (ch * 0.4) + 50, // 目標Y座標（基本は画面上部）
            timeInState: 0, // 状態管理用タイマー
            size: 60,
            hp: 5,       // 5発当てると問題フェーズへ変更
            maxHp: 5,
            color: '#ef4444',
            isMathTarget: false
        });
        phaseTimer = TIME_LIMIT; // 敵が出現したらシューティング用の5秒タイマー開始
    }
}, 2000);

// 数字入力
function inputNumber(num) {
    if (currentInputStr.length < 3) {
        currentInputStr += num;
        answerInput.textContent = currentInputStr;
        feedbackText.textContent = "";
    }
}

// 入力クリア
function clearInput() {
    currentInputStr = "";
    answerInput.textContent = "";
    feedbackText.textContent = "";
}

// 答え合わせ
function submitAnswer() {
    const inputVal = parseInt(currentInputStr, 10);
    if (inputVal === currentQuestion.answer) {
        // 正解！
        mathUI.style.display = 'none'; // テンキーを消す
        gameState = 'LASER_FIRING';    // レーザー発射状態へ (タイマーは停止)
        
        playLaserSound(); // レーザー発射音

        // トドメの極太レーザーを発射
        bullets.push({
            x: player.x,
            y: player.y,
            vy: -25,
            radius: 40, // 極太！
            type: 'laser',
            color: '#06b6d4' // シアン色のレーザー
        });
    } else {
        // 不正解
        feedbackText.textContent = "INCORRECT!";
        clearInput();
        // ここにペナルティ処理を入れることも可能（ダメージを受けるなど）
    }
}

// タイムアップ時のダメージ処理
function takeDamage() {
    playerLives--;
    screenFlashTimer = 20; // 画面を赤く光らせるフレーム数
    playDamageSound();
    
    // 現在の敵をリセット（逃げられた扱い）
    enemies = [];
    mathUI.style.display = 'none';
    clearInput();
    
    if (playerLives <= 0) {
        gameState = 'GAME_OVER';
        setTimeout(() => {
            if (gameState === 'GAME_OVER') backToMenu();
        }, 3000);
    } else {
        gameState = 'PLAYING';
        phaseTimer = 0; // 次の敵が出るまでタイマー停止
    }
}

// ゲームのリトライ
function resetGame() {
    playerLives = 3;
    gameState = 'PLAYING';
    enemies = [];
    bullets = [];
    particles = [];
    phaseTimer = 0;
    enemiesDefeated = 0;
    mathUI.style.display = 'none';
    clearInput();
}

// メニューのUIを更新する（ロック状態の反映）
function updateMenuUI() {
    const gridContainer = document.getElementById('stage-grid-container');
    gridContainer.innerHTML = ''; // 一度空にする
    
    for (let i = 1; i <= 9; i++) {
        const btn = document.createElement('button');
        const isLocked = i > maxUnlockedStage;
        btn.className = 'stage-btn' + (isLocked ? ' locked' : '');
        btn.textContent = `${i}の段`;
        btn.onclick = () => startGame(i);
        gridContainer.appendChild(btn);
    }
    
    const bossBtn = document.getElementById('boss-btn');
    if (maxUnlockedStage > 9) {
        bossBtn.classList.remove('locked');
    } else {
        bossBtn.classList.add('locked');
    }
}

// ステージを選んでゲーム開始
function startGame(stageNumber) {
    // ロックされているステージは開始できない
    if (stageNumber !== 10 && stageNumber > maxUnlockedStage) return;
    if (stageNumber === 10 && maxUnlockedStage <= 9) return;

    currentStage = stageNumber;
    menuUI.style.display = 'none';
    resetGame();
    startBGM(); // ここでBGMスタート
}

// メニューへ戻る
function backToMenu() {
    gameState = 'MENU';
    updateMenuUI(); // メニューに戻る時に最新のアンロック状態を反映
    menuUI.style.display = 'flex';
    enemies = [];
    bullets = [];
    particles = [];
    isBgmPlaying = false;
    if (Tone.Transport.state === 'started') Tone.Transport.stop();
}

function startMathMode(enemy) {
    gameState = 'MATH_MODE';
    enemy.isMathTarget = true;
    phaseTimer = TIME_LIMIT; // 問題が出たら計算用のタイマー開始
    
    // 選択されたステージに応じた問題を生成
    if (currentStage <= 9) {
        // 特定の段のステージ
        currentQuestion.a = currentStage;
        currentQuestion.b = Math.floor(Math.random() * 9) + 1; // 1〜9
    } else {
        // ぜんぶの段 (BOSS)
        currentQuestion.a = Math.floor(Math.random() * 8) + 2; // 2〜9
        currentQuestion.b = Math.floor(Math.random() * 8) + 2; // 2〜9
    }
    
    currentQuestion.answer = currentQuestion.a * currentQuestion.b;
    
    // UIの更新と表示
    questionText.textContent = `${currentQuestion.a} × ${currentQuestion.b} = ?`;
    clearInput();
    mathUI.style.display = 'flex';
}

function createExplosion(x, y, color, count) {
    for (let i = 0; i < count; i++) {
        particles.push({
            x: x,
            y: y,
            vx: (Math.random() - 0.5) * 20, // 速度を上げて派手に
            vy: (Math.random() - 0.5) * 20,
            life: 1.0,
            size: Math.random() * 6 + 2,    // サイズをランダムに
            color: ['#ef4444', '#f59e0b', '#fbbf24', '#ffffff', color][Math.floor(Math.random() * 5)] // ランダムな色
        });
    }
}

// 自機（プレイヤー）の描画関数
function drawPlayer(ctx, x, y, size, color) {
    ctx.save();
    ctx.translate(x, y);
    
    // エンジンの炎（ランダムに揺らぐ）
    ctx.fillStyle = '#f59e0b'; // オレンジ
    ctx.beginPath();
    ctx.moveTo(-size * 0.3, size * 0.8);
    ctx.lineTo(size * 0.3, size * 0.8);
    ctx.lineTo(0, size * 1.5 + Math.random() * size * 0.5);
    ctx.fill();

    // 翼
    ctx.fillStyle = '#1e3a8a'; // 暗い青
    ctx.beginPath();
    ctx.moveTo(0, -size * 0.2);
    ctx.lineTo(size, size * 0.8);
    ctx.lineTo(size * 0.4, size * 0.8);
    ctx.lineTo(0, size * 0.4);
    ctx.lineTo(-size * 0.4, size * 0.8);
    ctx.lineTo(-size, size * 0.8);
    ctx.fill();
    
    // 機体メイン
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, -size);
    ctx.lineTo(size * 0.4, size);
    ctx.lineTo(-size * 0.4, size);
    ctx.fill();
    
    // コックピットのキャノピー
    ctx.fillStyle = '#67e8f9'; // 水色
    ctx.beginPath();
    ctx.ellipse(0, -size * 0.1, size * 0.15, size * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
}

// 敵の宇宙船（UFO）の描画関数
function drawEnemy(ctx, x, y, size, color, isMathTarget) {
    ctx.save();
    ctx.translate(x, y);
    
    // 問題中（バリア）の描画
    if (isMathTarget) {
        ctx.strokeStyle = '#8b5cf6';
        ctx.lineWidth = 4;
        ctx.setLineDash([5, 5]); // 点線でバリアっぽく
        // 少し回転させる
        ctx.rotate(Date.now() / 500);
        ctx.beginPath();
        ctx.arc(0, 0, size * 0.8, 0, Math.PI * 2);
        ctx.stroke();
        // 回転を戻す
        ctx.rotate(-Date.now() / 500); 
        
        color = '#4c1d95'; // 本体色も紫っぽく変更
    }
    
    // UFOのガラスドーム
    ctx.fillStyle = '#a7f3d0';
    ctx.beginPath();
    ctx.arc(0, -size * 0.1, size * 0.35, Math.PI, 0);
    ctx.fill();

    // UFOの本体
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(0, size * 0.1, size * 0.6, size * 0.25, 0, 0, Math.PI * 2);
    ctx.fill();

    // 下部のライト（チカチカ点滅させる）
    let isBlinking = Math.floor(Date.now() / 200) % 2 === 0;
    ctx.fillStyle = isBlinking ? '#fde047' : '#ca8a04';
    for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.arc(i * size * 0.3, size * 0.1, size * 0.08, 0, Math.PI * 2);
        ctx.fill();
    }

    ctx.restore();
}

function gameLoop() {
    // 画面クリア（少し残像を残す）
    ctx.fillStyle = 'rgba(17, 24, 39, 0.4)';
    ctx.fillRect(0, 0, cw, ch);

    // タイマー進行とタイムアップ判定
    if ((gameState === 'PLAYING' && enemies.length > 0) || gameState === 'MATH_MODE') {
        phaseTimer--;
        if (phaseTimer <= 0) {
            takeDamage(); // 5秒経過でミス！
        }
    }

    // 背景の星の描画と更新
    ctx.fillStyle = 'white';
    stars.forEach(star => {
        ctx.fillRect(star.x, star.y, star.size, star.size);
        star.y += star.speed;
        if (star.y > ch) {
            star.y = 0;
            star.x = Math.random() * cw;
        }
    });

    // プレイヤー描画 (新しい関数を使用)
    drawPlayer(ctx, player.x, player.y, player.size, player.color);

    // 弾の更新と描画
    for (let i = bullets.length - 1; i >= 0; i--) {
        let b = bullets[i];
        
        // MATH_MODE中は通常の弾は止まる
        if (gameState !== 'MATH_MODE' || b.type === 'laser') {
            b.y += b.vy;
        }

        ctx.fillStyle = b.type === 'laser' ? b.color : 'yellow';
        if(b.type === 'laser') {
            // 極太レーザーの描画
            ctx.shadowBlur = 20;
            ctx.shadowColor = b.color;
            ctx.fillRect(b.x - b.radius/2, b.y, b.radius, player.y - b.y);
            ctx.shadowBlur = 0;
        } else {
            // 通常弾
            ctx.beginPath();
            ctx.arc(b.x, b.y, b.radius, 0, Math.PI*2);
            ctx.fill();
        }

        // 画面外削除
        if (b.y < -100) {
            bullets.splice(i, 1);
            // STAGE_CLEAR（クリア画面）でなければ通常プレイ状態に戻す
            if (b.type === 'laser' && gameState !== 'STAGE_CLEAR' && gameState !== 'GAME_OVER') {
                gameState = 'PLAYING';
            }
            continue;
        }

        // 衝突判定
        for (let j = enemies.length - 1; j >= 0; j--) {
            let e = enemies[j];
            let dist = Math.hypot(b.x - e.x, b.y - e.y);
            
            // レーザーの場合は、先端（b.y）が敵の高さに届いたタイミングで全画面ヒットとする
            let isLaserHit = b.type === 'laser' && b.y <= e.y + e.size/2;
            
            if ((b.type === 'normal' && dist < e.size/2 + b.radius) || isLaserHit) {
                // 通常弾のヒット
                if (b.type === 'normal' && gameState === 'PLAYING') {
                    e.hp--;
                    createExplosion(b.x, b.y, 'yellow', 15); // パーティクル増量
                    playExplosionSound(false);               // 小爆発音
                    bullets.splice(i, 1);
                    
                    if (e.hp <= 0) {
                        startMathMode(e); // HPがゼロになったら問題フェーズへ！
                    }
                    break;
                }
                
                // トドメのレーザーヒット
                if (b.type === 'laser' && e.isMathTarget) {
                    createExplosion(e.x, e.y, '#ef4444', 150); // 圧倒的なパーティクル量
                    playExplosionSound(true);                  // 大爆発音
                    enemies.splice(j, 1);
                    enemiesDefeated++;
                    
                    // ステージクリア判定 (BOSSは15体、通常は7体)
                    let targetKills = (currentStage === 10) ? 15 : 7;
                    if (enemiesDefeated >= targetKills) {
                        if (gameState !== 'STAGE_CLEAR') {
                            gameState = 'STAGE_CLEAR';
                            
                            // クリアしたら次のステージを解放
                            if (currentStage === maxUnlockedStage) {
                                maxUnlockedStage++;
                            }
                            
                            setTimeout(() => {
                                if (gameState === 'STAGE_CLEAR') backToMenu();
                            }, 3000);
                        }
                    }
                }
            }
        }
    }

    // 敵の更新と描画
    for (let i = enemies.length - 1; i >= 0; i--) {
        let e = enemies[i];
        
        if (gameState === 'PLAYING') {
            e.timeInState++;
            
            // 目標座標へ向かって滑らかに移動 (イージング)
            e.x += (e.tx - e.x) * 0.03;
            e.y += (e.ty - e.y) * 0.03;
            
            // 常に横にゆらゆら揺れる動きを加える
            e.x += Math.sin(e.timeInState * 0.05) * 3;

            // 画面外に出ないように制限
            e.x = Math.max(e.size/2, Math.min(cw - e.size/2, e.x));

            // 一定時間経過するか、目標に近づいたら新しい目標を設定
            if (e.timeInState > 120 || Math.hypot(e.tx - e.x, e.ty - e.y) < 10) {
                e.timeInState = 0;
                e.tx = Math.random() * (cw - e.size) + e.size/2;
                
                // 30%の確率で下に急降下アタック、それ以外は上空をランダム移動
                if (Math.random() < 0.3) {
                    e.ty = ch - 150; // 画面下部へ急降下
                } else {
                    e.ty = Math.random() * (ch * 0.4) + 50; // 画面上部でランダム
                }
            }
        }

        // 自機との当たり判定 (プレイ中のみ)
        if (gameState === 'PLAYING') {
            let distToPlayer = Math.hypot(player.x - e.x, player.y - e.y);
            // プレイヤーと敵の大きさから当たり判定の距離を計算（少し甘め）
            if (distToPlayer < (player.size + e.size) * 0.4) {
                takeDamage();
                continue; // takeDamageで敵配列がクリアされるため、描画をスキップ
            }
        }

        // 敵の描画 (新しい関数を使用)
        drawEnemy(ctx, e.x, e.y, e.size, e.color, e.isMathTarget);
        
        // HPバー
        if (!e.isMathTarget) {
            ctx.fillStyle = 'red';
            ctx.fillRect(e.x - e.size/2, e.y - e.size/2 - 15, e.size, 5); // バーを少し上に
            ctx.fillStyle = '#10b981';
            ctx.fillRect(e.x - e.size/2, e.y - e.size/2 - 15, e.size * (e.hp / e.maxHp), 5);
        }
    }

    // パーティクルの更新と描画
    for (let i = particles.length - 1; i >= 0; i--) {
        let p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.life -= 0.03; // 消える速度を少し遅くして余韻を残す
        
        if (p.life <= 0) {
            particles.splice(i, 1);
            continue;
        }
        
        ctx.globalAlpha = p.life;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size || 3, 0, Math.PI*2); // ランダムサイズ適用
        ctx.fill();
        ctx.globalAlpha = 1.0;
    }

    // ダメージ時のフラッシュエフェクト
    if (screenFlashTimer > 0) {
        ctx.fillStyle = `rgba(239, 68, 68, ${screenFlashTimer / 20})`; // 赤色
        ctx.fillRect(0, 0, cw, ch);
        screenFlashTimer--;
    }

    // --- HUD (UI) の描画 ---
    // プレイ中のみHUDを表示
    if (gameState !== 'MENU') {
        // ライフの描画
        ctx.textAlign = 'left';
        ctx.font = '24px sans-serif'; 
        let hearts = '';
        for (let i = 0; i < playerLives; i++) {
            hearts += '❤️ ';
        }
        ctx.fillText(hearts, 20, 40);

        // 進行度の描画 (例: 1/5)
        ctx.fillStyle = 'white';
        ctx.font = 'bold 20px monospace';
        ctx.textAlign = 'right';
        let stageName = currentStage <= 9 ? `${currentStage}の段` : 'BOSS';
        let targetKills = (currentStage === 10) ? 15 : 7;
        ctx.fillText(`${stageName} - ${enemiesDefeated}/${targetKills}`, cw - 20, 40);
    }

    // タイマーゲージの描画
    if ((gameState === 'PLAYING' && enemies.length > 0) || gameState === 'MATH_MODE') {
        let barWidth = cw * 0.8; // バーの幅を画面の80%に拡大
        let barHeight = 15;      // バーの高さも少し太く
        let barX = cw / 2 - barWidth / 2;
        let barY = 30;
        
        // 背景
        ctx.fillStyle = 'rgba(255, 255, 255, 0.2)'; 
        ctx.fillRect(barX, barY, barWidth, barHeight);
        
        // 残り時間バー (30%以下で赤くなる)
        let ratio = Math.max(0, phaseTimer / TIME_LIMIT);
        ctx.fillStyle = ratio > 0.3 ? '#facc15' : '#ef4444'; // 緑から黄色(#facc15)に変更
        ctx.fillRect(barX, barY, barWidth * ratio, barHeight);
        
        // ラベルテキスト
        ctx.fillStyle = 'white';
        ctx.font = 'bold 12px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(gameState === 'PLAYING' ? "SHOOT TIME" : "MATH TIME", cw / 2, barY - 10);
    }

    // ゲームオーバー画面
    if (gameState === 'GAME_OVER') {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillRect(0, 0, cw, ch);
        
        ctx.fillStyle = '#ef4444';
        ctx.font = 'bold 40px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('GAME OVER', cw / 2, ch / 2 - 20);
        
        ctx.fillStyle = 'white';
        ctx.font = 'bold 20px monospace';
        ctx.fillText('TAP TO BACK TO MENU', cw / 2, ch / 2 + 30);
    }

    // ステージクリア画面
    if (gameState === 'STAGE_CLEAR') {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillRect(0, 0, cw, ch);
        
        ctx.fillStyle = '#10b981'; // 緑色
        ctx.font = 'bold 40px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('STAGE CLEAR!', cw / 2, ch / 2 - 20);
        
        ctx.fillStyle = 'white';
        ctx.font = 'bold 20px monospace';
        ctx.fillText('TAP TO BACK TO MENU', cw / 2, ch / 2 + 30);
    }

    requestAnimationFrame(gameLoop);
}

// ゲーム開始
document.getElementById('boss-btn').addEventListener('click', () => startGame(10));
document.querySelector('.keypad-grid').addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) return;

    const button = event.target.closest('button');
    if (!button) return;

    if (button.dataset.number !== undefined) {
        inputNumber(Number(button.dataset.number));
    } else if (button.dataset.action === 'clear') {
        clearInput();
    } else if (button.dataset.action === 'submit') {
        submitAnswer();
    }
});

updateMenuUI();
gameLoop();
