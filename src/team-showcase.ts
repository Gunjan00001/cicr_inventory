/**
 * TeamShowcaseManager — "Meet the Developers" carousel.
 * Renders the mentor/team tabs, hero card and social links. Depends on core/ui. */

// ==========================================
// Team Showcase Manager (GDG JIIT Style Interactive Showcase)
// ==========================================
interface TeamMember {
    id: string;
    name: string;
    role: string;
    greeting?: string;
    avatar: string;
    avatarPos: string;
    accentColor: string;
    firstNameColor?: string;
    lastNameColor?: string;
    socials: {
        platform: 'linkedin' | 'github';
        label: string;
        url: string;
    }[];
}

export class TeamShowcaseManager {
    private static activeCategory: 'mentors' | 'team' = 'team';
    private static activeIndex: number = 0;
    private static isInitialized: boolean = false;

    private static readonly MENTORS: TeamMember[] = [
        {
            id: 'gunjan',
            name: 'Gunjan Pal',
            role: 'Core Team',
            greeting: 'Hi, my name is',
            avatar: '/devs/gunjan.jpg',
            avatarPos: 'center 20%',
            accentColor: '#bd00ff',
            firstNameColor: '#bd00ff',
            lastNameColor: '#ff007a',
            socials: [
                { platform: 'linkedin', label: 'Gunjan Pal', url: 'https://www.linkedin.com/in/gunjan-pal-796093284/' },
                { platform: 'github', label: 'Gunjan00001', url: 'https://github.com/Gunjan00001' }
            ]
        }
    ];

    private static readonly TEAM: TeamMember[] = [
        {
            id: 'vardaan',
            name: 'Vardaan Saxena',
            role: 'Frontend + Integration • Bug Solver',
            greeting: 'Hi, my name is',
            avatar: '/devs/vardaan.jpg',
            avatarPos: 'center 24%',
            accentColor: '#00f0ff',
            firstNameColor: '#ff3366',
            lastNameColor: '#00f0ff',
            socials: [
                { platform: 'linkedin', label: 'Vardaan Saxena', url: 'https://www.linkedin.com/in/vardaan-saxena-b4b4a4365/' },
                { platform: 'github', label: 'simplyvardaan', url: 'https://github.com/simplyvardaan/' }
            ]
        },
        {
            id: 'kushagra',
            name: 'Kushagra Garg',
            role: 'Backend',
            greeting: 'Hi, my name is',
            avatar: '/devs/kushagra.png',
            avatarPos: 'center 8%',
            accentColor: '#00ff88',
            firstNameColor: '#00ff88',
            lastNameColor: '#00f0ff',
            socials: [
                { platform: 'linkedin', label: 'Kushagra Garg', url: 'https://www.linkedin.com/in/kushagra-garg-10bab5377/' },
                { platform: 'github', label: 'Sun-fire-nikka', url: 'https://github.com/Sun-fire-nikka' }
            ]
        },
        {
            id: 'mahak',
            name: 'Mahak Katahara',
            role: 'Contributor',
            greeting: 'Hi, my name is',
            avatar: '/devs/mahak.png',
            avatarPos: 'center 18%',
            accentColor: '#ff007a',
            firstNameColor: '#ff007a',
            lastNameColor: '#bd00ff',
            socials: [
                { platform: 'linkedin', label: 'Mahak Katahara', url: 'https://www.linkedin.com/in/mahak-katahara-947122389/' },
                { platform: 'github', label: 'mahakkatahara', url: 'https://github.com/mahakkatahara' }
            ]
        },
        {
            id: 'divyam',
            name: 'Divyam Jain',
            role: 'Beta Tester',
            greeting: 'Hi, my name is',
            avatar: '/devs/divyam.png',
            avatarPos: 'center 15%',
            accentColor: '#ffb703',
            firstNameColor: '#ffb703',
            lastNameColor: '#00f0ff',
            socials: [
                { platform: 'linkedin', label: 'Divyam Jain', url: 'https://www.linkedin.com/in/divyamjain8108' },
                { platform: 'github', label: 'DJByteForge', url: 'https://github.com/DJByteForge' }
            ]
        }
    ];

    public static init() {
        this.bindEvents();
        this.renderCategory(this.activeCategory);
    }

    private static getCurrentList(): TeamMember[] {
        return this.activeCategory === 'mentors' ? this.MENTORS : this.TEAM;
    }

    public static setCategory(category: 'mentors' | 'team') {
        this.activeCategory = category;
        this.activeIndex = 0;
        this.renderCategory(category);
    }

    public static selectMember(index: number) {
        const list = this.getCurrentList();
        if (index < 0) index = list.length - 1;
        if (index >= list.length) index = 0;
        this.activeIndex = index;
        this.renderHeroCard(list[this.activeIndex]);
        this.updateCarouselActiveState();
    }

    public static nextMember() {
        this.selectMember(this.activeIndex + 1);
    }

    public static prevMember() {
        this.selectMember(this.activeIndex - 1);
    }

    private static renderCategory(category: 'mentors' | 'team') {
        // Update tab button active states
        const tabMentors = document.getElementById('team-tab-mentors');
        const tabTeam = document.getElementById('team-tab-team');
        if (tabMentors) tabMentors.classList.toggle('active', category === 'mentors');
        if (tabTeam) tabTeam.classList.toggle('active', category === 'team');

        const tabMentorsCount = document.querySelector('#team-tab-mentors .category-count');
        if (tabMentorsCount) tabMentorsCount.textContent = String(this.MENTORS.length);
        const tabTeamCount = document.querySelector('#team-tab-team .category-count');
        if (tabTeamCount) tabTeamCount.textContent = String(this.TEAM.length);

        const list = this.getCurrentList();
        if (this.activeIndex >= list.length) this.activeIndex = 0;

        // Render carousel track avatars
        const track = document.getElementById('team-carousel-track');
        if (track) {
            track.innerHTML = list.map((m, idx) => `
                <button type="button" class="team-avatar-selector ${idx === this.activeIndex ? 'active' : ''}" data-index="${idx}" aria-label="View profile of ${m.name}">
                    <div class="selector-avatar-circle" style="--accent: ${m.accentColor};">
                        <img src="${m.avatar}" alt="${m.name}" class="selector-avatar-img" style="object-position: ${m.avatarPos};" loading="lazy">
                    </div>
                    <span class="selector-avatar-name">${m.name.split(' ')[0]}</span>
                </button>
            `).join('');

            // Add click & touch listeners to avatar items
            track.querySelectorAll('.team-avatar-selector').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    const idx = parseInt(btn.getAttribute('data-index') || '0', 10);
                    this.selectMember(idx);
                });
            });
        }

        // Render Hero Card for current active member
        this.renderHeroCard(list[this.activeIndex]);
        this.updateArrowStates();
    }

    private static renderHeroCard(m: TeamMember) {
        const card = document.getElementById('team-hero-card');
        const avatarImg = document.getElementById('hero-avatar-img') as HTMLImageElement;
        const rolePill = document.getElementById('hero-role-pill');
        const displayName = document.getElementById('hero-display-name');
        const socialLinks = document.getElementById('hero-social-links');
        const ambientGlow = document.getElementById('hero-ambient-glow');
        const glowRing = document.getElementById('hero-avatar-glow-ring');

        if (!m) return;

        // Split name for GDG JIIT style dual-color headline
        const nameParts = m.name.split(' ');
        const firstName = nameParts[0] || '';
        const lastName = nameParts.slice(1).join(' ') || '';

        // Trigger subtle animation
        if (card) {
            card.classList.remove('hero-fade-active');
            void card.offsetWidth; // Force reflow
            card.classList.add('hero-fade-active');
            card.style.setProperty('--card-accent', m.accentColor);
        }

        if (avatarImg) {
            avatarImg.src = m.avatar;
            avatarImg.alt = m.name;
            avatarImg.style.objectPosition = m.avatarPos;
        }

        const tagRow = document.querySelector('.hero-tag-row');
        if (tagRow) {
            if (m.role.includes('•')) {
                const parts = m.role.split('•').map(s => s.trim());
                tagRow.innerHTML = parts.map((part, idx) => `
                    <span class="hero-role-pill ${idx > 0 ? 'hero-role-pill-secondary' : ''}" id="${idx === 0 ? 'hero-role-pill' : 'hero-role-pill-secondary'}" style="color: ${idx === 0 ? m.accentColor : '#00f0ff'}; border-color: ${idx === 0 ? m.accentColor + '66' : 'rgba(0, 240, 255, 0.45)'}; box-shadow: 0 0 14px ${idx === 0 ? m.accentColor + '33' : 'rgba(0, 240, 255, 0.2)'};">
                        ${part.toLowerCase().includes('bug') ? '<i data-lucide="bug" style="width:13px;height:13px;display:inline-block;vertical-align:-1.5px;margin-right:4px;"></i>' : ''}${part}
                    </span>
                `).join('');
                if ((window as any).lucide && (window as any).lucide.createIcons) {
                    (window as any).lucide.createIcons();
                }
            } else {
                tagRow.innerHTML = `
                    <span class="hero-role-pill" id="hero-role-pill" style="color: ${m.accentColor}; border-color: ${m.accentColor}66; box-shadow: 0 0 14px ${m.accentColor}33;">
                        ${m.role}
                    </span>
                `;
            }
        } else if (rolePill) {
            rolePill.textContent = m.role;
            rolePill.style.color = m.accentColor;
            rolePill.style.borderColor = `${m.accentColor}66`;
            rolePill.style.boxShadow = `0 0 14px ${m.accentColor}33`;
        }

        if (displayName) {
            displayName.style.setProperty('--first-name-color', m.firstNameColor || m.accentColor);
            displayName.style.setProperty('--last-name-color', m.lastNameColor || m.accentColor);
            displayName.innerHTML = `
                <span class="hero-first-name">${firstName}</span>
                <span class="hero-last-name">${lastName}</span>
            `;
        }

        if (ambientGlow) {
            ambientGlow.style.background = m.accentColor;
        }

        if (glowRing) {
            glowRing.style.background = `conic-gradient(from 180deg, ${m.accentColor}, #bd00ff, #ff007a, ${m.accentColor})`;
            glowRing.style.boxShadow = `0 0 38px ${m.accentColor}66, 0 0 16px rgba(189, 0, 255, 0.3)`;
        }

        const getSocialIconSvg = (platform: 'linkedin' | 'github') => {
            if (platform === 'github') {
                return `<svg class="social-icon-svg" viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/></svg>`;
            }
            if (platform === 'linkedin') {
                return `<svg class="social-icon-svg" viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z"/></svg>`;
            }
            return '';
        };

        if (socialLinks) {
            socialLinks.innerHTML = m.socials.map(s => `
                <a href="${s.url}" target="_blank" rel="noopener noreferrer" class="hero-social-pill" title="${m.name} on ${s.platform === 'github' ? 'GitHub' : 'LinkedIn'}">
                    ${getSocialIconSvg(s.platform)}
                    <span>${s.label}</span>
                </a>
            `).join('');
        }

        if (typeof lucide !== 'undefined' && lucide.createIcons) {
            lucide.createIcons();
        }
    }

    private static updateArrowStates() {
        const list = this.getCurrentList();
        const btnPrev = document.getElementById('team-carousel-prev') as HTMLButtonElement | null;
        const btnNext = document.getElementById('team-carousel-next') as HTMLButtonElement | null;
        if (btnPrev && btnNext) {
            if (list.length <= 1) {
                btnPrev.style.opacity = '0.3';
                btnPrev.style.pointerEvents = 'none';
                btnNext.style.opacity = '0.3';
                btnNext.style.pointerEvents = 'none';
            } else {
                btnPrev.style.opacity = '1';
                btnPrev.style.pointerEvents = 'auto';
                btnNext.style.opacity = '1';
                btnNext.style.pointerEvents = 'auto';
            }
        }
    }

    private static updateCarouselActiveState() {
        const track = document.getElementById('team-carousel-track');
        if (!track) return;

        const items = track.querySelectorAll('.team-avatar-selector');
        items.forEach((item, idx) => {
            const isActive = idx === this.activeIndex;
            item.classList.toggle('active', isActive);
            if (isActive && track) {
                try {
                    const el = item as HTMLElement;
                    const targetLeft = el.offsetLeft - (track.clientWidth - el.clientWidth) / 2;
                    track.scrollTo({ left: targetLeft, behavior: 'smooth' });
                } catch (_) {}
            }
        });
        this.updateArrowStates();
    }

    private static bindEvents() {
        if (this.isInitialized) return;
        this.isInitialized = true;

        const tabMentors = document.getElementById('team-tab-mentors');
        const tabTeam = document.getElementById('team-tab-team');
        const btnPrev = document.getElementById('team-carousel-prev');
        const btnNext = document.getElementById('team-carousel-next');

        if (tabMentors) {
            tabMentors.addEventListener('click', () => this.setCategory('mentors'));
        }

        if (tabTeam) {
            tabTeam.addEventListener('click', () => this.setCategory('team'));
        }

        // Highly responsive, touch-optimized side arrow navigation with debounce
        let lastNavTime = 0;
        const throttledNav = (action: () => void) => (e: Event) => {
            const now = Date.now();
            if (now - lastNavTime < 200) {
                e.preventDefault();
                return;
            }
            lastNavTime = now;
            e.preventDefault();
            e.stopPropagation();
            action();
        };

        if (btnPrev) {
            const onPrev = throttledNav(() => this.prevMember());
            btnPrev.addEventListener('click', onPrev);
            btnPrev.addEventListener('touchend', onPrev, { passive: false });
        }

        if (btnNext) {
            const onNext = throttledNav(() => this.nextMember());
            btnNext.addEventListener('click', onNext);
            btnNext.addEventListener('touchend', onNext, { passive: false });
        }

        // Touch swipe gestures for mobile on hero card and carousel container
        let touchStartX = 0;
        let touchStartY = 0;
        const heroCardEl = document.getElementById('team-hero-card');
        const carouselEl = document.querySelector('.team-selector-carousel-container');

        const attachSwipe = (el: Element | null) => {
            if (!el) return;
            el.addEventListener('touchstart', (e: any) => {
                if (e.touches && e.touches.length === 1) {
                    touchStartX = e.touches[0].clientX;
                    touchStartY = e.touches[0].clientY;
                }
            }, { passive: true });

            el.addEventListener('touchend', (e: any) => {
                if (e.changedTouches && e.changedTouches.length === 1) {
                    const deltaX = e.changedTouches[0].clientX - touchStartX;
                    const deltaY = e.changedTouches[0].clientY - touchStartY;
                    if (Math.abs(deltaX) > 40 && Math.abs(deltaX) > Math.abs(deltaY) * 1.3) {
                        if (deltaX < 0) {
                            this.nextMember();
                        } else {
                            this.prevMember();
                        }
                    }
                }
            }, { passive: true });
        };

        attachSwipe(heroCardEl);
        attachSwipe(carouselEl);

        // Keyboard navigation support when viewing developers section
        document.addEventListener('keydown', (e) => {
            const devSection = document.getElementById('developers-view');
            if (!devSection || devSection.style.display === 'none') return;
            if (e.key === 'ArrowLeft') {
                this.prevMember();
            } else if (e.key === 'ArrowRight') {
                this.nextMember();
            }
        });
    }
}

(window as any).TeamShowcaseManager = TeamShowcaseManager;
