import React, { useState, useEffect, useRef, useCallback } from 'react';
import ReactDOM from 'react-dom/client';

// --- 1. CONFIGURACIÓN Y TIPOS ---

enum GameState {
  START = 'START',
  PLAYING = 'PLAYING',
  GAMEOVER = 'GAMEOVER',
  PAUSED = 'PAUSED'
}

interface InputState {
  left: boolean;
  right: boolean;
  shoot: boolean;
}

const COLORS = {
  blue: '#00ffff',
  pink: '#ff00ff',
  green: '#00ff00',
  red: '#ff0000',
  yellow: '#ffff00',
  white: '#ffffff',
  bg: '#050505'
};

const GAME_WIDTH = 800;
const GAME_HEIGHT = 600;

// --- 2. SERVICIO DE AUDIO ---

class AudioService {
  private ctx: AudioContext | null = null;

  private getContext(): AudioContext {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    return this.ctx;
  }

  public async resume() {
    const ctx = this.getContext();
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
  }

  public playSound(type: 'shoot' | 'explosion' | 'gameover' | 'powerup') {
    try {
      const ctx = this.getContext();
      const osc = ctx.createOscillator();
      const gainNode = ctx.createGain();

      osc.connect(gainNode);
      gainNode.connect(ctx.destination);

      const now = ctx.currentTime;

      if (type === 'shoot') {
        osc.type = 'square';
        osc.frequency.setValueAtTime(800, now);
        osc.frequency.exponentialRampToValueAtTime(100, now + 0.1);
        gainNode.gain.setValueAtTime(0.05, now);
        gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
        osc.start(now);
        osc.stop(now + 0.1);
      } else if (type === 'explosion') {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(200, now);
        osc.frequency.exponentialRampToValueAtTime(10, now + 0.3);
        gainNode.gain.setValueAtTime(0.1, now);
        gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
        osc.start(now);
        osc.stop(now + 0.3);
      } else if (type === 'gameover') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(300, now);
        osc.frequency.linearRampToValueAtTime(50, now + 1.5);
        gainNode.gain.setValueAtTime(0.1, now);
        gainNode.gain.linearRampToValueAtTime(0, now + 1.5);
        osc.start(now);
        osc.stop(now + 1.5);
      } else if (type === 'powerup') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(400, now);
        osc.frequency.exponentialRampToValueAtTime(1200, now + 0.3);
        gainNode.gain.setValueAtTime(0.1, now);
        gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
        osc.start(now);
        osc.stop(now + 0.3);
      }
    } catch (e) {
      // Ignorar errores de audio si el navegador es muy estricto
    }
  }
}

const audioService = new AudioService();

// --- 3. CLASES DEL JUEGO (ENTIDADES) ---

class GameObject {
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  markedForDeletion: boolean = false;

  constructor(x: number, y: number, width: number, height: number, color: string) {
    this.x = x;
    this.y = y;
    this.width = width;
    this.height = height;
    this.color = color;
  }
}

class Player extends GameObject {
  speed: number = 8;
  lastShot: number = 0;

  constructor() {
    super(GAME_WIDTH / 2 - 20, GAME_HEIGHT - 60, 40, 40, COLORS.blue);
  }

  update(input: InputState, fireProjectile: (x: number, y: number) => void) {
    if (input.left && this.x > 0) this.x -= this.speed;
    if (input.right && this.x < GAME_WIDTH - this.width) this.x += this.speed;

    if (input.shoot) {
      const now = Date.now();
      if (now - this.lastShot > 200) {
        fireProjectile(this.x, this.y);
        fireProjectile(this.x + this.width, this.y);
        audioService.playSound('shoot');
        this.lastShot = now;
      }
    }
  }

  draw(ctx: CanvasRenderingContext2D) {
    ctx.strokeStyle = this.color;
    ctx.lineWidth = 2;
    ctx.shadowBlur = 10;
    ctx.shadowColor = this.color;
    ctx.strokeRect(this.x, this.y, this.width, this.height);
    ctx.beginPath();
    ctx.moveTo(this.x, this.y + this.height);
    ctx.lineTo(this.x - 10, this.y + this.height + 10);
    ctx.stroke();
    ctx.moveTo(this.x + this.width, this.y + this.height);
    ctx.lineTo(this.x + this.width + 10, this.y + this.height + 10);
    ctx.stroke();
    ctx.shadowBlur = 0;
  }
}

class Projectile extends GameObject {
  speed: number;
  isPlayer: boolean;

  constructor(x: number, y: number, speed: number, color: string, isPlayer: boolean) {
    super(x, y, 4, 12, color);
    this.speed = speed;
    this.isPlayer = isPlayer;
  }

  update() {
    this.y += this.speed;
    if (this.y < -20 || this.y > GAME_HEIGHT + 20) this.markedForDeletion = true;
  }

  draw(ctx: CanvasRenderingContext2D) {
    ctx.shadowColor = this.color;
    ctx.shadowBlur = 10;
    ctx.fillStyle = this.color;
    ctx.fillRect(this.x, this.y, this.width, this.height);
    ctx.shadowBlur = 0;
  }
}

class Enemy extends GameObject {
  type: number;
  points: number;
  hasPowerup: boolean;

  constructor(x: number, y: number, type: number, hasPowerup: boolean = false) {
    super(x, y, 35, 35, type === 1 ? COLORS.red : type === 2 ? COLORS.pink : COLORS.green);
    this.type = type;
    this.hasPowerup = hasPowerup;
    this.points = type === 1 ? 50 : type === 2 ? 30 : 10;
    if (this.hasPowerup) this.color = '#ffaa00';
  }

  draw(ctx: CanvasRenderingContext2D) {
    ctx.strokeStyle = this.color;
    ctx.lineWidth = 2;
    ctx.shadowColor = this.color;
    ctx.shadowBlur = this.hasPowerup ? 15 : 5;

    if (this.type === 1) {
        ctx.beginPath();
        ctx.moveTo(this.x, this.y);
        ctx.lineTo(this.x + this.width, this.y);
        ctx.lineTo(this.x + this.width / 2, this.y + this.height);
        ctx.closePath();
        ctx.stroke();
    } else if (this.type === 2) {
        ctx.beginPath();
        ctx.arc(this.x + this.width/2, this.y + this.height/2, this.width/2, 0, Math.PI * 2);
        ctx.stroke();
    } else {
        ctx.strokeRect(this.x, this.y, this.width, this.height);
    }
    
    if (this.hasPowerup) {
      ctx.fillStyle = this.color;
      ctx.beginPath();
      ctx.arc(this.x + this.width/2, this.y + this.height/2, 4, 0, Math.PI*2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;
  }
}

class Powerup extends GameObject {
  constructor(x: number, y: number) {
    super(x, y, 20, 20, '#00ff00');
  }

  update() {
    this.y += 3;
    if (this.y > GAME_HEIGHT) this.markedForDeletion = true;
  }

  draw(ctx: CanvasRenderingContext2D) {
    ctx.shadowColor = this.color;
    ctx.shadowBlur = 10;
    ctx.fillStyle = this.color;
    ctx.beginPath();
    const x = this.x + this.width / 2;
    const y = this.y + this.height / 2;
    const size = this.width / 2;
    ctx.moveTo(x, y + size * 0.7);
    ctx.bezierCurveTo(x + size, y, x + size, y - size, x, y - size * 0.5);
    ctx.bezierCurveTo(x - size, y - size, x - size, y, x, y + size * 0.7);
    ctx.fill();
    ctx.shadowBlur = 0;
  }
}

class Particle extends GameObject {
  vx: number;
  vy: number;
  life: number = 1;

  constructor(x: number, y: number, color: string) {
    super(x, y, 3, 3, color);
    this.vx = (Math.random() - 0.5) * 8;
    this.vy = (Math.random() - 0.5) * 8;
  }

  update() {
    this.x += this.vx;
    this.y += this.vy;
    this.life -= 0.04;
    if (this.life <= 0) this.markedForDeletion = true;
  }

  draw(ctx: CanvasRenderingContext2D) {
    ctx.globalAlpha = Math.max(0, this.life);
    ctx.fillStyle = this.color;
    ctx.fillRect(this.x, this.y, this.width, this.height);
    ctx.globalAlpha = 1;
  }
}

// --- 4. COMPONENTES DE UI ---

const Button: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' }> = ({ children, variant = 'primary', className = '', ...props }) => {
  const baseStyles = "font-['Press_Start_2P'] uppercase text-xs sm:text-sm py-3 px-6 border-2 transition-all transform active:scale-95 shadow-[0_0_10px_currentColor]";
  const variants = {
    primary: "border-cyan-400 text-cyan-400 hover:bg-cyan-400 hover:text-black",
    secondary: "border-fuchsia-500 text-fuchsia-500 hover:bg-fuchsia-500 hover:text-black",
    danger: "border-red-500 text-red-500 hover:bg-red-500 hover:text-black",
  };
  return <button className={`${baseStyles} ${variants[variant]} ${className}`} {...props}>{children}</button>;
};

// Logo SVG Incrustado
const NeonRocketLogo: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 100 100" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M50 5 L50 5 Q65 30 65 60 L50 55 L35 60 Q35 30 50 5 Z" stroke="#ff00ff" strokeWidth="2" fill="rgba(255, 0, 255, 0.1)" className="drop-shadow-[0_0_5px_#f0f]" />
    <line x1="50" y1="5" x2="50" y2="55" stroke="#ff00ff" strokeWidth="1" opacity="0.5" />
    <path d="M35 60 L20 75 L35 70" stroke="#00ffff" strokeWidth="2" fill="none" className="drop-shadow-[0_0_5px_#0ff]" />
    <path d="M65 60 L80 75 L65 70" stroke="#00ffff" strokeWidth="2" fill="none" className="drop-shadow-[0_0_5px_#0ff]" />
    <circle cx="50" cy="35" r="8" stroke="#00ffff" strokeWidth="2" fill="#000" className="drop-shadow-[0_0_5px_#0ff]" />
    <path d="M40 70 Q50 95 60 70" stroke="#ffff00" strokeWidth="2" fill="rgba(255, 255, 0, 0.3)" className="drop-shadow-[0_0_8px_#ff0]" />
  </svg>
);

// Controles Táctiles
const btnBase = "rounded-full border-2 bg-white/5 backdrop-blur-md flex items-center justify-center text-2xl select-none transition-all touch-none active:scale-90 shadow-lg";

const ShootButton: React.FC<{ inputRef: React.MutableRefObject<InputState>, btnSizeClass?: string }> = ({ inputRef, btnSizeClass = "w-20 h-20" }) => {
  const handleTouch = useCallback((active: boolean) => (e: any) => {
    e.preventDefault(); e.stopPropagation();
    inputRef.current.shoot = active;
    if (active && navigator.vibrate) navigator.vibrate(10);
  }, [inputRef]);

  return <button className={`${btnBase} ${btnSizeClass} border-red-500/50 text-red-500 shadow-red-900/20 active:bg-red-500 active:text-white`}
    onMouseDown={handleTouch(true)} onMouseUp={handleTouch(false)} onMouseLeave={handleTouch(false)} onTouchStart={handleTouch(true)} onTouchEnd={handleTouch(false)}>🔥</button>;
};

const DPad: React.FC<{ inputRef: React.MutableRefObject<InputState>, className?: string, btnSizeClass?: string }> = ({ inputRef, className = '', btnSizeClass = "w-20 h-20" }) => {
  const handleTouch = useCallback((key: 'left' | 'right', active: boolean) => (e: any) => {
    e.preventDefault(); e.stopPropagation();
    inputRef.current[key] = active;
    if (active && navigator.vibrate) navigator.vibrate(10);
  }, [inputRef]);

  return <div className={`flex gap-4 ${className}`}>
    <button className={`${btnBase} ${btnSizeClass} border-cyan-400/50 text-cyan-400 shadow-cyan-900/20 active:bg-cyan-400 active:text-black`}
      onMouseDown={handleTouch('left', true)} onMouseUp={handleTouch('left', false)} onMouseLeave={handleTouch('left', false)} onTouchStart={handleTouch('left', true)} onTouchEnd={handleTouch('left', false)}>◀</button>
    <button className={`${btnBase} ${btnSizeClass} border-cyan-400/50 text-cyan-400 shadow-cyan-900/20 active:bg-cyan-400 active:text-black`}
      onMouseDown={handleTouch('right', true)} onMouseUp={handleTouch('right', false)} onMouseLeave={handleTouch('right', false)} onTouchStart={handleTouch('right', true)} onTouchEnd={handleTouch('right', false)}>▶</button>
  </div>;
};

// --- 5. COMPONENTE CANVAS DEL JUEGO ---

const GameCanvas: React.FC<{
  gameState: GameState;
  setGameState: (s: GameState) => void;
  setScore: (s: number) => void;
  setLives: (l: number) => void;
  inputRef: React.MutableRefObject<InputState>;
}> = ({ gameState, setGameState, setScore, setLives, inputRef }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const requestRef = useRef<number>(0);
  
  const gameRef = useRef({
    player: new Player(),
    projectiles: [] as Projectile[],
    enemies: [] as Enemy[],
    particles: [] as Particle[],
    powerups: [] as Powerup[],
    score: 0,
    lives: 3,
    level: 1,
    enemyDir: 1
  });

  const initGame = () => {
    const g = gameRef.current;
    g.player = new Player();
    g.projectiles = [];
    g.particles = [];
    g.powerups = [];
    g.score = 0;
    g.lives = 3;
    g.level = 1;
    g.enemyDir = 1;
    setScore(0);
    setLives(3);
    initEnemies();
  };

  const initEnemies = () => {
    const g = gameRef.current;
    g.enemies = [];
    const rows = 4;
    const cols = 8;
    const startX = (GAME_WIDTH - (cols * 50)) / 2;
    const powerupIndex = Math.floor(Math.random() * cols);

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        let type = (r === 0) ? 1 : (r === 1 ? 2 : 3);
        const hasPowerup = (r === 0 && c === powerupIndex);
        g.enemies.push(new Enemy(startX + c * 50, 50 + r * 50, type, hasPowerup));
      }
    }
  };

  const checkCollision = (rect1: GameObject, rect2: GameObject) => {
    return (
      rect1.x < rect2.x + rect2.width &&
      rect1.x + rect1.width > rect2.x &&
      rect1.y < rect2.y + rect2.height &&
      rect1.y + rect1.height > rect2.y
    );
  };

  const animate = (time: number) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    ctx.fillStyle = 'rgba(5, 5, 5, 0.4)';
    ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

    if (gameState === GameState.PLAYING) {
      const g = gameRef.current;

      g.player.update(inputRef.current, (x, y) => {
        g.projectiles.push(new Projectile(x, y, -12, COLORS.yellow, true));
      });
      g.player.draw(ctx);

      let hitEdge = false;
      g.enemies.forEach(e => {
        e.x += (1.5 + g.score * 0.001) * g.enemyDir;
        if (e.x <= 10 || e.x >= GAME_WIDTH - 40) hitEdge = true;
        
        if (Math.random() < 0.001 + (g.level * 0.0002)) {
             g.projectiles.push(new Projectile(e.x + 15, e.y + 30, 5, COLORS.red, false));
        }

        if (e.y + e.height >= g.player.y) {
            g.lives = 0;
            setLives(0);
            setGameState(GameState.GAMEOVER);
            audioService.playSound('gameover');
        }
        e.draw(ctx);
      });

      if (hitEdge) {
        g.enemyDir *= -1;
        g.enemies.forEach(e => e.y += 20);
      }

      if (g.enemies.length === 0) {
          g.level++;
          g.score += 1000;
          initEnemies();
      }

      g.projectiles.forEach(p => {
        p.update();
        p.draw(ctx);
        if (p.isPlayer) {
            g.enemies.forEach(e => {
                if (checkCollision(p, e)) {
                    e.markedForDeletion = true;
                    p.markedForDeletion = true;
                    g.score += e.points;
                    setScore(g.score);
                    audioService.playSound('explosion');
                    if (e.hasPowerup) g.powerups.push(new Powerup(e.x + 5, e.y + 5));
                    for(let i=0; i<5; i++) g.particles.push(new Particle(e.x, e.y, e.color));
                }
            });
        } else {
            if (checkCollision(p, g.player)) {
                p.markedForDeletion = true;
                g.lives--;
                setLives(g.lives);
                audioService.playSound('explosion');
                 for(let i=0; i<10; i++) g.particles.push(new Particle(g.player.x, g.player.y, COLORS.blue));
                if (g.lives <= 0) {
                    setGameState(GameState.GAMEOVER);
                    audioService.playSound('gameover');
                }
            }
        }
      });

      g.powerups.forEach(p => {
        p.update();
        p.draw(ctx);
        if (checkCollision(p, g.player)) {
            p.markedForDeletion = true;
            g.lives = Math.min(g.lives + 1, 5);
            setLives(g.lives);
            audioService.playSound('powerup');
            for(let i=0; i<8; i++) g.particles.push(new Particle(g.player.x, g.player.y, COLORS.green));
        }
      });

      g.enemies = g.enemies.filter(e => !e.markedForDeletion);
      g.projectiles = g.projectiles.filter(p => !p.markedForDeletion);
      g.powerups = g.powerups.filter(p => !p.markedForDeletion);
      g.particles.forEach(p => { p.update(); p.draw(ctx); });
      g.particles = g.particles.filter(p => !p.markedForDeletion);
    }
    requestRef.current = requestAnimationFrame(animate);
  };

  useEffect(() => {
    if (gameState === GameState.START) {
        const ctx = canvasRef.current?.getContext('2d');
        if(ctx) { ctx.fillStyle = '#050505'; ctx.fillRect(0,0, GAME_WIDTH, GAME_HEIGHT); }
    }
    if (gameState === GameState.PLAYING) {
        if(gameRef.current.lives <= 0 || gameRef.current.enemies.length === 0) initGame();
        requestRef.current = requestAnimationFrame(animate);
    }
    return () => cancelAnimationFrame(requestRef.current);
  }, [gameState]);

  return <canvas ref={canvasRef} width={GAME_WIDTH} height={GAME_HEIGHT} className="w-full h-full block object-contain" style={{ imageRendering: 'pixelated' }} />;
};

// --- 6. APP PRINCIPAL ---

const App: React.FC = () => {
  const [gameState, setGameState] = useState<GameState>(GameState.START);
  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(3);
  const [showInfo, setShowInfo] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  
  const inputRef = useRef<InputState>({ left: false, right: false, shoot: false });

  useEffect(() => {
    const checkLayout = () => {
      const mobile = window.matchMedia('(pointer: coarse)').matches || window.innerWidth < 1024;
      setIsMobile(mobile);
    };
    checkLayout();
    window.addEventListener('resize', checkLayout);
    window.addEventListener('orientationchange', checkLayout);
    return () => { window.removeEventListener('resize', checkLayout); window.removeEventListener('orientationchange', checkLayout); };
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'ArrowLeft') inputRef.current.left = true;
      if (e.code === 'ArrowRight') inputRef.current.right = true;
      if (e.code === 'Space') inputRef.current.shoot = true;
      if (e.code === 'Enter' && gameState !== GameState.PLAYING) startGame();
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'ArrowLeft') inputRef.current.left = false;
      if (e.code === 'ArrowRight') inputRef.current.right = false;
      if (e.code === 'Space') inputRef.current.shoot = false;
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => { window.removeEventListener('keydown', handleKeyDown); window.removeEventListener('keyup', handleKeyUp); };
  }, [gameState]);

  const startGame = async () => {
    await audioService.resume();
    setGameState(GameState.PLAYING);
    setShowInfo(false);
  };

  return (
    <div className="fixed inset-0 bg-[#080808] flex items-center justify-center overflow-hidden touch-none select-none">
      <div className={`relative w-full h-full flex items-center justify-center ${isMobile ? 'flex-col landscape:flex-row landscape:justify-between landscape:px-8 lg:landscape:px-16' : 'p-4'}`}>
        
        {/* LANDSCAPE CONTROLS: LEFT */}
        {isMobile && gameState === GameState.PLAYING && (
          <div className="hidden landscape:flex flex-col justify-center items-center h-full z-20 w-24 shrink-0 animate-in fade-in duration-300">
             <DPad inputRef={inputRef} btnSizeClass="w-16 h-16 lg:w-20 lg:h-20" className="gap-2" />
          </div>
        )}

        {/* SCREEN WRAPPER */}
        <div className={`relative bg-black shadow-[0_0_30px_rgba(0,0,0,0.8)] border-2 border-[#1a1a1a] overflow-hidden shrink-0 transition-all duration-300 aspect-[4/3] w-full h-auto max-h-[60vh] landscape:w-auto landscape:h-[92vh] landscape:max-h-none md:h-[85vh] md:w-auto`}>
          <GameCanvas gameState={gameState} setGameState={setGameState} setScore={setScore} setLives={setLives} inputRef={inputRef} />

          <div className="absolute inset-0 pointer-events-none p-4 flex flex-col justify-between z-10">
            <div className="flex justify-between items-start w-full font-bold text-xs sm:text-base pointer-events-none opacity-90 tracking-widest">
              <div className="text-yellow-300 drop-shadow-[0_0_4px_rgba(255,255,0,0.8)]">SCORE: {score.toString().padStart(6, '0')}</div>
              <div className="text-green-400 drop-shadow-[0_0_4px_rgba(0,255,0,0.8)]">LIVES: {'❤'.repeat(Math.max(0, lives))}</div>
            </div>

            {gameState === GameState.START && !showInfo && (
              <div className="absolute inset-0 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center text-center pointer-events-auto p-4 z-20">
                <NeonRocketLogo className="w-32 h-32 mb-4 animate-bounce" />
                <h1 className="text-3xl sm:text-5xl lg:text-6xl text-fuchsia-500 mb-6 drop-shadow-[0_0_15px_#f0f] tracking-tighter leading-tight">NEON<br/>SPACE<br/>SHOOTER</h1>
                <div className="flex flex-col gap-4 w-full max-w-[200px]">
                  <Button onClick={startGame}>JUGAR</Button>
                  <Button variant="secondary" onClick={() => setShowInfo(true)}>AYUDA</Button>
                </div>
              </div>
            )}

            {gameState === GameState.GAMEOVER && (
              <div className="absolute inset-0 bg-black/90 backdrop-blur-md flex flex-col items-center justify-center text-center pointer-events-auto p-4 z-20">
                <h2 className="text-4xl sm:text-6xl text-red-600 mb-4 drop-shadow-[0_0_20px_red] tracking-tighter">GAME OVER</h2>
                <p className="text-white mb-8 text-sm sm:text-lg tracking-widest">PUNTAJE: <span className="text-yellow-400 block text-2xl mt-2">{score}</span></p>
                <Button onClick={startGame}>REINTENTAR</Button>
              </div>
            )}

            {showInfo && (
              <div className="absolute inset-0 bg-black/95 flex flex-col items-center justify-center text-center pointer-events-auto p-6 z-30">
                <h2 className="text-lg text-yellow-400 mb-4 border-b border-yellow-400 pb-2 tracking-widest uppercase">Instrucciones</h2>
                <div className="text-left space-y-3 text-[10px] sm:text-xs text-gray-300 mb-6 max-w-xs leading-relaxed font-mono">
                    <p>• <span className="text-white">Objetivo:</span> Destruye las naves enemigas.</p>
                    <p>• <span className="text-fuchsia-400">Bonus:</span> Los triángulos sueltan <span className="text-green-400">Vidas</span>.</p>
                    <div className="mt-4 pt-4 border-t border-gray-800 opacity-75">
                      <p>PC: Flechas (Mover) + Espacio (Disparar)</p>
                      <p>Móvil: Usa los botones en pantalla</p>
                    </div>
                </div>
                <Button variant="danger" onClick={() => setShowInfo(false)} className="py-2 text-xs">CERRAR</Button>
              </div>
            )}

            {gameState === GameState.PLAYING && (
              <NeonRocketLogo className="absolute bottom-2 right-2 w-12 h-12 opacity-30 pointer-events-none z-0" />
            )}
          </div>
          
          {/* CRT SCANLINES */}
          <div className="absolute inset-0 pointer-events-none z-40 bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.1)_50%),linear-gradient(90deg,rgba(255,0,0,0.03),rgba(0,255,0,0.01),rgba(0,0,255,0.03))] bg-[length:100%_4px,3px_100%] opacity-20"></div>
          <div className="absolute inset-0 pointer-events-none z-40 bg-[radial-gradient(circle_at_center,transparent_60%,rgba(0,0,0,0.4)_100%)]"></div>
        </div>

        {/* LANDSCAPE CONTROLS: RIGHT */}
        {isMobile && gameState === GameState.PLAYING && (
          <div className="hidden landscape:flex flex-col justify-center items-center h-full z-20 w-24 shrink-0 animate-in fade-in duration-300 delay-75">
             <ShootButton inputRef={inputRef} btnSizeClass="w-20 h-20 lg:w-24 lg:h-24" />
          </div>
        )}

        {/* PORTRAIT CONTROLS: BOTTOM */}
        {isMobile && gameState === GameState.PLAYING && (
          <div className="flex landscape:hidden w-full justify-between items-center px-8 py-6 z-50 mt-auto animate-in slide-in-from-bottom-10 fade-in duration-300 pointer-events-none">
             <div className="pointer-events-auto">
                <DPad inputRef={inputRef} btnSizeClass="w-16 h-16" className="gap-4" />
             </div>
             <div className="pointer-events-auto">
                <ShootButton inputRef={inputRef} btnSizeClass="w-20 h-20" />
             </div>
          </div>
        )}
      </div>
      
      <footer className="absolute bottom-1 w-full text-center z-50 pointer-events-auto pb-1">
        <p className="text-[9px] text-gray-600 font-['Press_Start_2P'] uppercase tracking-wider">
          Todos los derechos reservados para{' '}
          <a href="https://studio--hitsterai.us-central1.hosted.app/es" target="_blank" rel="noopener noreferrer" className="text-cyan-600 hover:text-cyan-400 transition-colors border-b border-dashed border-cyan-800 hover:border-cyan-400">
            Hitster Ai
          </a>
        </p>
      </footer>
    </div>
  );
};

// --- 7. MONTAJE DE LA APLICACIÓN ---
const rootEl = document.getElementById('root');
if (rootEl) {
  const root = ReactDOM.createRoot(rootEl);
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
} else {
  console.error("No se encontró el elemento #root");
}
