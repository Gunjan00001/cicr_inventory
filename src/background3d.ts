/**
 * Background3D — Three.js particle field rendered on #canvas-3d.
 * Active only for the "decent" theme; disabled on touch/mobile devices. */

import * as THREE from 'three';

// ==========================================
// 2. High-Performance Background Engine
// ==========================================
export class Background3D {
    private canvas: HTMLCanvasElement;
    private scene!: THREE.Scene;
    private camera!: THREE.PerspectiveCamera;
    private renderer!: THREE.WebGLRenderer;

    private particles!: THREE.Points;
    private particlePhases: Float32Array = new Float32Array(0);
    private currentTheme = 'mono';

    private mouseX = 0;
    private mouseY = 0;
    private targetCameraX = 0;
    private targetCameraY = 4;
    private lastFrameTime = 0;
    private readonly frameInterval = 1000 / 30;

    private isInitialized = false;

    constructor() {
        this.canvas = document.getElementById('canvas-3d') as HTMLCanvasElement;
        if (!this.canvas) return;

        // Skip WebGL initialization on mobile & touch devices
        const isMobile = typeof window !== 'undefined' && (window.innerWidth < 768 || (window.matchMedia && window.matchMedia('(pointer: coarse)').matches));
        if (isMobile) {
            this.canvas.style.display = 'none';
            return;
        }

        const activeTheme = (typeof localStorage !== 'undefined' && (localStorage.getItem('cicr_vault_theme') || localStorage.getItem('cicr_theme'))) || 'light';
        this.currentTheme = activeTheme;

        // Strictly lazy-boot Three.js WebGL engine ONLY when Cyber Decent theme is active
        if (activeTheme === 'decent') {
            this.startEngine();
        } else {
            this.canvas.style.display = 'none';
        }
    }

    private rafId: number | null = null;

    private startEngine() {
        if (this.isInitialized) return;
        this.isInitialized = true;
        if (this.canvas) this.canvas.style.display = '';
        this.init();
        this.createLighting();
        this.createParticles();
        this.setupEvents();
        if (this.currentTheme === 'decent') {
            this.start();
        }
    }

    public start() {
        if (this.currentTheme !== 'decent') return;
        if (window.innerWidth < 768 || (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(pointer: coarse)').matches)) return;
        if (this.rafId === null) {
            this.animate();
        }
    }

    public stop() {
        if (this.rafId !== null) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
    }

    private init() {
        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(0x0d0d0c, 0.015);

        this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.set(0, 4, 18);
        this.camera.lookAt(0, 0, 0);

        this.renderer = new THREE.WebGLRenderer({
            canvas: this.canvas,
            antialias: true,
            alpha: true,
            powerPreference: "high-performance"
        });
        const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(isMobile ? 1 : Math.min(window.devicePixelRatio, 2));
    }

    private createLighting() {
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(ambientLight);

        const pointLight = new THREE.PointLight(0xf5f5f2, 1.2, 100);
        pointLight.position.set(0, 10, -20);
        this.scene.add(pointLight);

        const pointLight2 = new THREE.PointLight(0x9c78ed, 1.0, 100);
        pointLight2.position.set(20, 5, 10);
        this.scene.add(pointLight2);
    }

    public updateThemeColors(theme: string) {
        this.currentTheme = theme;
        if (theme === 'decent') {
            const isMobile = typeof window !== 'undefined' && (window.innerWidth < 768 || (window.matchMedia && window.matchMedia('(pointer: coarse)').matches));
            if (isMobile) {
                this.stop();
                if (this.canvas) this.canvas.style.display = 'none';
                return;
            }
            if (this.canvas) this.canvas.style.display = '';
            if (!this.isInitialized) {
                this.startEngine();
            }
            this.setParticleColorsForTheme(theme);
            this.start();
        } else {
            this.stop();
            if (this.canvas) this.canvas.style.display = 'none';
        }
    }

    private setParticleColorsForTheme(theme: string) {
        if (!this.particles) return;
        const colors = this.particles.geometry.attributes.color.array as Float32Array;
        const count = colors.length / 3;

        // Precalculated RGB normalized floats - zero heap allocations in loop
        const r1 = theme === 'light' ? 0.6117 : 0.451;
        const g1 = theme === 'light' ? 0.4705 : 0.451;
        const b1 = theme === 'light' ? 0.9294 : 0.451;

        const r2 = theme === 'light' ? 0.9607 : 0.9607;
        const g2 = theme === 'light' ? 0.7215 : 0.9607;
        const b2 = theme === 'light' ? 0.9215 : 0.949;

        for (let i = 0; i < count; i++) {
            const ratio = Math.random();
            colors[i * 3] = r1 + (r2 - r1) * ratio;
            colors[i * 3 + 1] = g1 + (g2 - g1) * ratio;
            colors[i * 3 + 2] = b1 + (b2 - b1) * ratio;
        }

        this.particles.geometry.attributes.color.needsUpdate = true;
    }

    private createParticles() {
        const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
        const particleCount = isMobile ? 60 : 250;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(particleCount * 3);
        const colors = new Float32Array(particleCount * 3);
        this.particlePhases = new Float32Array(particleCount);

        for (let i = 0; i < particleCount; i++) {
            positions[i * 3] = (Math.random() - 0.5) * 120;
            positions[i * 3 + 1] = Math.random() * 40 - 10;
            positions[i * 3 + 2] = (Math.random() - 0.7) * 150;
            this.particlePhases[i] = Math.random() * Math.PI * 2;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

        const material = new THREE.PointsMaterial({
            size: isMobile ? 0.20 : 0.24,
            vertexColors: true,
            transparent: true,
            opacity: 0.88,
            blending: THREE.AdditiveBlending
        });

        this.particles = new THREE.Points(geometry, material);
        this.scene.add(this.particles);
        this.setParticleColorsForTheme(this.currentTheme);
    }

    private setupEvents() {
        window.addEventListener('mousemove', (e) => {
            if (window.innerWidth < 768) return;
            this.mouseX = (e.clientX / window.innerWidth) * 2 - 1;
            this.mouseY = -(e.clientY / window.innerHeight) * 2 + 1;
        }, { passive: true });

        let resizeRaf: number | null = null;
        window.addEventListener('resize', () => {
            if (this.currentTheme === 'mono' || this.currentTheme === 'light' || window.innerWidth < 768) {
                return;
            }
            if (resizeRaf) cancelAnimationFrame(resizeRaf);
            resizeRaf = requestAnimationFrame(() => {
                if (!this.renderer || !this.camera) return;
                const width = window.innerWidth;
                const height = window.innerHeight;
                this.camera.aspect = width / height;
                this.camera.updateProjectionMatrix();
                this.renderer.setSize(width, height, false);
                this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
            });
        }, { passive: true });
    }

    private animate() {
        if (this.currentTheme !== 'decent') {
            this.stop();
            return;
        }
        if (typeof document !== 'undefined' && document.hidden) {
            this.rafId = requestAnimationFrame(() => this.animate());
            return;
        }

        // Mobile & touch device acceleration: bypass Three.js render loop to eliminate lag and save battery
        if (window.innerWidth < 768 || (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(pointer: coarse)').matches)) {
            this.stop();
            return;
        }

        if (this.canvas && this.canvas.offsetParent === null && window.getComputedStyle(this.canvas).display === 'none') {
            this.rafId = requestAnimationFrame(() => this.animate());
            return;
        }

        const isScrolling = !!(window as any).isUserScrolling;
        if (isScrolling) {
            this.rafId = requestAnimationFrame(() => this.animate());
            return;
        }

        const now = performance.now();
        const delta = now - this.lastFrameTime;
        if (delta < this.frameInterval) {
            this.rafId = requestAnimationFrame(() => this.animate());
            return;
        }
        this.lastFrameTime = now - (delta % this.frameInterval);

        if (this.particles) {
            const positions = this.particles.geometry.attributes.position.array as Float32Array;
            const particleCount = positions.length / 3;

            for (let i = 0; i < particleCount; i++) {
                positions[i * 3 + 1] += 0.015;
                positions[i * 3 + 2] += 0.03;

                if (positions[i * 3 + 1] > 30) {
                    positions[i * 3 + 1] = -5;
                }
                if (positions[i * 3 + 2] > 20) {
                    positions[i * 3 + 2] = -120;
                    positions[i * 3] = (Math.random() - 0.5) * 120;
                }
            }
            this.particles.geometry.attributes.position.needsUpdate = true;
        }

        this.targetCameraX = this.mouseX * 3;
        this.targetCameraY = 4 + (this.mouseY * 1.5);

        this.camera.position.x += (this.targetCameraX - this.camera.position.x) * 0.05;
        this.camera.position.y += (this.targetCameraY - this.camera.position.y) * 0.05;

        this.camera.lookAt(0, -1, -5);

        this.renderer.render(this.scene, this.camera);
        this.rafId = requestAnimationFrame(() => this.animate());
    }
}
