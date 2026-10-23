
        let isAdminLoggedIn = false;
        let PAYSITE_URL = "";

        let siteData = {
            general: {
                tickerText: "FQ MMA / TEAM S.N.R.G. MMA • OFFICIAL SITE",
                countdownTitle: "Date TBA",
                countdownDate: "",
                paysiteUrl: ""
            },
            disciplines: [{"id":1,"name":"Traditional Karate","desc":"A traditional Japanese martial art built around disciplined basics, strong stances, blocks, strikes, forms, and controlled partner practice.","link":"","imageUrl":""},{"id":2,"name":"Shotokan","desc":"A style of karate known for deep stances, precise linear techniques, powerful basics, kata, timing, and distance control.","link":"","imageUrl":""},{"id":3,"name":"Kickboxing","desc":"A stand-up combat sport combining punches and kicks, with training in combinations, footwork, defense, conditioning, and controlled sparring.","link":"","imageUrl":""},{"id":4,"name":"Muay Thai","desc":"Thailand’s striking art using punches, kicks, knees, elbows, and clinch work, developed through technique, balance, conditioning, and pad drills.","link":"","imageUrl":""},{"id":5,"name":"Boxing","desc":"A striking sport focused on punches, footwork, head movement, defense, timing, combinations, and ring awareness.","link":"","imageUrl":""},{"id":6,"name":"Kids Boxing","desc":"Age-appropriate boxing fundamentals emphasizing coordination, balance, fitness, focus, confidence, safe technique, and non-contact drills.","link":"","imageUrl":""},{"id":7,"name":"Judo","desc":"A Japanese grappling art and Olympic sport focused on throws, trips, pins, balance-breaking, safe falling, and controlled groundwork.","link":"","imageUrl":""},{"id":8,"name":"Jiu Jitsu","desc":"A grappling art focused on positional control, escapes, transitions, takedowns, and submission techniques practiced with control and respect.","link":"","imageUrl":""},{"id":9,"name":"Wrestling","desc":"A grappling sport that develops takedowns, control, balance, pressure, escapes, conditioning, and the ability to defend or improve position.","link":"","imageUrl":""},{"id":10,"name":"Kids Kickboxing","desc":"A kid-friendly introduction to punches, kicks, movement, balance, and fitness using structured drills that build focus, confidence, and respect.","link":"","imageUrl":""}],
            schedule: [],
            fighters: [],
            store: [],
            portfolio: [],
            promos: []
        };

        // Expose the same object to the Supabase bridge; edits continue to mutate this object.
        window.siteData = siteData;

        let availableStreamOptions = [];

        async function getFunctionErrorMessage(error, fallback) {
            try {
                const response = error?.context;
                if (response && typeof response.clone === 'function') {
                    const payload = await response.clone().json();
                    if (typeof payload?.error === 'string' && payload.error.trim()) return payload.error;
                    if (typeof payload?.message === 'string' && payload.message.trim()) return payload.message;
                }
            } catch (_) {
                // The response may be absent, already consumed, or not JSON.
            }
            return error?.message || fallback;
        }

        function closeStreamCheckout() {
            document.getElementById('streamCheckoutModal').classList.add('hidden');
        }

        async function openStreamCheckout(options = {}) {
            const focusPromo = options.focusPromo === true;
            if (!window.sb || !window.supabaseReady) {
                showNotification("Live-stream checkout is not available right now. No payment will be taken.", "info");
                return;
            }
            const modal = document.getElementById('streamCheckoutModal');
            const select = document.getElementById('streamCheckoutEvent');
            const message = document.getElementById('streamCheckoutMessage');
            const submit = document.getElementById('streamCheckoutSubmit');
            const price = document.getElementById('streamCheckoutPrice');
            modal.classList.remove('hidden');
            select.innerHTML = '';
            const loading = document.createElement('option');
            loading.value = '';
            loading.textContent = 'Choose an event';
            select.appendChild(loading);
            submit.disabled = true;
            message.textContent = 'Checking event availability…';
            try {
                const { data, error } = await window.sb.functions.invoke('list-available-streams', { body: {} });
                if (error) throw error;
                availableStreamOptions = Array.isArray(data?.streams) ? data.streams : [];
                select.innerHTML = '';
                if (!availableStreamOptions.length) {
                    const empty = document.createElement('option');
                    empty.value = '';
                    empty.textContent = 'No stream available';
                    select.appendChild(empty);
                    price.textContent = 'One-time access is available when an event is listed.';
                    message.textContent = 'No live-stream event is available right now.';
                    return;
                }
                for (const stream of availableStreamOptions) {
                    const option = document.createElement('option');
                    option.value = stream.event_id;
                    const isFightQuestXVI = /fight quest xvi/i.test(String(stream.title || ''));
                    const dateText = stream.event_date
                        ? ' · ' + (isFightQuestXVI
                            ? new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/Los_Angeles' }).format(new Date(stream.event_date)) + ' · Doors 6 PM · Fights 7 PM'
                            : formatLongDateTime(stream.event_date))
                        : ' · Date to be announced';
                    const amount = Number(stream.price_cents || 0) <= 0 ? 'FREE' : new Intl.NumberFormat('en-US', { style: 'currency', currency: stream.currency || 'USD' }).format(stream.price_cents / 100);
                    const detailText = [stream.venue, stream.main_event].filter(Boolean).join(' · ');
                    option.textContent = (stream.title || 'FQ MMA event') + dateText + ' · ' + amount + ' · Live only, no replay' + (detailText ? ' · ' + detailText : '');
                    select.appendChild(option);
                }
                const updatePrice = () => {
                    const selected = availableStreamOptions.find((stream) => stream.event_id === select.value);
                    if (!selected) return;
                    price.textContent = Number(selected.price_cents || 0) <= 0 ? 'Complimentary live access · Live event only · No replay' : 'Live event only: ' + new Intl.NumberFormat('en-US', { style: 'currency', currency: selected.currency || 'USD' }).format((selected.price_cents || 0) / 100) + ' · No replay';
                };
                select.onchange = updatePrice;
                updatePrice();
                submit.disabled = false;
                message.textContent = Number(availableStreamOptions.find((stream) => stream.event_id === select.value)?.price_cents || 0) <= 0 ? 'Enter your email to open the free live stream.' : 'Enter your email to continue to secure checkout.';
            } catch (error) {
                availableStreamOptions = [];
                submit.disabled = true;
                message.textContent = await getFunctionErrorMessage(error, 'Live-stream checkout is temporarily unavailable. No payment was taken.');
            } finally {
                if (focusPromo) document.getElementById('streamCheckoutPromotionCode')?.focus();
            }
        }

        document.getElementById('streamCheckoutClose').addEventListener('click', closeStreamCheckout);
        document.getElementById('streamCheckoutForm').addEventListener('submit', async (event) => {
            event.preventDefault();
            const select = document.getElementById('streamCheckoutEvent');
            const email = document.getElementById('streamCheckoutEmail').value.trim();
            const message = document.getElementById('streamCheckoutMessage');
            const submit = document.getElementById('streamCheckoutSubmit');
            if (!availableStreamOptions.some((stream) => stream.event_id === select.value)) {
                message.textContent = 'Choose an available stream event first.';
                return;
            }
            submit.disabled = true;
            submit.textContent = 'Preparing stream access…';
            message.textContent = '';
            try {
                await window.ensureSupabaseClient();
                if (!window.supabaseReady || !window.sb) throw new Error('Secure checkout is temporarily unavailable. Please try again shortly.');
                const { data, error } = await window.sb.functions.invoke('create-stream-checkout', {
                    body: { event_id: select.value, buyer_email: email, promotion_code: document.getElementById('streamCheckoutPromotionCode').value.trim(), accepted_terms: document.getElementById('streamCheckoutTermsAccepted').checked }
                });
                if (error) throw error;
                if (data?.free_url && data.free_url.startsWith('https://fq-snrg-mma.com/watch.html?free_event_id=')) { window.location.assign(data.free_url); return; }
                if (!data?.url || !data.url.startsWith('https://checkout.stripe.com/')) throw new Error(data?.error || 'Secure checkout could not be opened.');
                window.location.assign(data.url);
            } catch (error) {
                message.textContent = await getFunctionErrorMessage(error, 'Could not start checkout. No payment was taken.');
                submit.disabled = false;
                submit.textContent = 'Continue to secure payment';
            }
        });

        function redirectToPaysite() {
            openStreamCheckout();
        }

        function openTicketCheckout(optionId, ticketName, ticketPrice) {
            if (!window.sb || !window.supabaseReady) { showNotification("Ticket checkout is not available right now. Please try again later.", "error"); return; }
            document.getElementById('ticketCheckoutOptionId').value = optionId;
            document.getElementById('ticketCheckoutTitle').textContent = ticketName || 'Buy event tickets';
            document.getElementById('ticketCheckoutPrice').textContent = ticketPrice ? 'Price per ticket: ' + ticketPrice : '';
            document.getElementById('ticketCheckoutMessage').textContent = '';
            document.getElementById('ticketCheckoutModal').classList.remove('hidden');
            document.getElementById('ticketCheckoutEmail').focus();
        }

        function closeTicketCheckout() {
            document.getElementById('ticketCheckoutModal').classList.add('hidden');
        }

        document.addEventListener('click', (event) => {
            const button = event.target.closest('[data-buy-ticket]');
            if (button) openTicketCheckout(button.dataset.buyTicket, button.dataset.ticketName, button.dataset.ticketPrice);
            if (event.target.id === 'ticketCheckoutModal') closeTicketCheckout();
        });
        document.getElementById('ticketCheckoutClose').addEventListener('click', closeTicketCheckout);
        document.getElementById('ticketCheckoutForm').addEventListener('submit', async (event) => {
            event.preventDefault();
            const submit = document.getElementById('ticketCheckoutSubmit');
            const message = document.getElementById('ticketCheckoutMessage');
            const quantity = Number(document.getElementById('ticketCheckoutQuantity').value);
            const email = document.getElementById('ticketCheckoutEmail').value.trim();
            if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10) { message.textContent = 'Choose between 1 and 10 tickets.'; return; }
            submit.disabled = true;
            submit.textContent = 'Preparing secure checkout…';
            message.textContent = '';
            try {
                await window.ensureSupabaseClient();
                if (!window.supabaseReady || !window.sb) throw new Error('Secure checkout is temporarily unavailable. Please try again shortly.');
                const { data, error } = await window.sb.functions.invoke('create-ticket-checkout', {
                    body: { ticket_option_id: document.getElementById('ticketCheckoutOptionId').value, quantity, buyer_email: email, promotion_code: document.getElementById('ticketCheckoutPromotionCode').value.trim(), accepted_terms: document.getElementById('ticketCheckoutTermsAccepted').checked }
                });
                if (error) throw error;
                if (!data || !data.url || !data.url.startsWith('https://checkout.stripe.com/')) throw new Error(data?.error || 'Secure checkout could not be opened.');
                window.location.assign(data.url);
            } catch (error) {
                message.textContent = await getFunctionErrorMessage(error, 'Could not start checkout. No payment was taken.');
                submit.disabled = false;
                submit.textContent = 'Continue to secure payment';
            }
        });

        function openCustomLink(url) {
            const destination = String(url || '').trim();
            if (!destination) {
                showNotification("Official links will be posted here when available.", "info");
                return;
            }
            let parsed;
            try { parsed = new URL(destination, window.location.href); }
            catch { showNotification("This link is not valid.", "error"); return; }
            if (!['http:', 'https:'].includes(parsed.protocol)) {
                showNotification("Only secure web links are supported.", "error");
                return;
            }
            window.open(parsed.href, '_blank', 'noopener,noreferrer');
        }

        function togglePaywallModal() {
            openStreamCheckout({ focusPromo: true });
        }

        function openAdminModal() {
            // Keep one source of truth for administration instead of opening the legacy in-page dashboard.
            window.location.href = './admin.html';
        }

        function closeAdminLoginModal() {
            document.getElementById('admin-login-modal').classList.add('hidden');
        }

        async function isCurrentUserAdmin(user) {
            if (!window.supabaseReady || !user) return false;
            const { data, error } = await window.sb.from('admin_users').select('user_id').eq('user_id', user.id).maybeSingle();
            if (error) throw error;
            return !!data;
        }

        async function activateAdminSession(user) {
            if (!await isCurrentUserAdmin(user)) {
                await window.sb.auth.signOut();
                throw new Error('This account is not authorized to access the administrator dashboard. Contact the site owner.');
            }
            isAdminLoggedIn = true;
            window.__snrgAdminUser = user;
            document.getElementById('admin-login-modal').classList.add('hidden');
            document.getElementById('admin-modal').classList.remove('hidden');
            cleanupExpiredPromos(); renderAdminManagerLists();
            await loadSiteContentFromSupabase();
            showNotification('Administrator signed in securely.', 'success');
        }

        async function verifyAdminPin(e) {
            e.preventDefault();
            const errorBox = document.getElementById('admin-login-error'); errorBox.textContent = '';
            try {
                if (!window.supabaseReady) throw new Error('Administrator sign-in is temporarily unavailable. Please try again later.');
                const email = document.getElementById('admin-email-input').value.trim();
                const password = document.getElementById('admin-pin-input').value;
                const { data, error } = await window.sb.auth.signInWithPassword({ email, password });
                if (error) throw error;
                await activateAdminSession(data.user);
                document.getElementById('admin-pin-input').value = '';
            } catch (err) { errorBox.textContent = err.message || 'Sign-in failed.'; }
        }

        function toggleAdminPasswordVisibility(visible) {
            document.getElementById('admin-pin-input').type = visible ? 'text' : 'password';
        }

        async function sendAdminSignInLink() {
            const errorBox = document.getElementById('admin-login-error');
            errorBox.className = 'text-xs text-red-400';
            errorBox.textContent = '';
            try {
                if (!window.supabaseReady) throw new Error('Email sign-in is temporarily unavailable. Please try again later.');
                const emailInput = document.getElementById('admin-email-input');
                if (!emailInput.reportValidity()) return;
                const redirectUrl = new URL(window.location.href);
                redirectUrl.search = '?admin=1';
                redirectUrl.hash = '';
                const { error } = await window.sb.auth.signInWithOtp({
                    email: emailInput.value.trim(),
                    options: { shouldCreateUser: false, emailRedirectTo: redirectUrl.href }
                });
                if (error) throw error;
                errorBox.className = 'text-xs text-emerald-400';
                errorBox.textContent = 'If this email belongs to an existing account, a sign-in link has been sent. Only approved administrators can open the dashboard.';
            } catch (err) { errorBox.textContent = err.message || 'Could not send the sign-in link.'; }
        }

        function requestAdminAccessEmail(event) {
            event.preventDefault();
            const email = document.getElementById('admin-email-input').value.trim();
            const subject = encodeURIComponent('Request for administrator access');
            const body = encodeURIComponent(`Please review my request for administrator access.${email ? `\n\nAccount email: ${email}` : ''}`);
            window.location.href = `mailto:support@fq-snrg-mma.com?subject=${subject}&body=${body}`;
            return false;
        }

        async function signInAdminWithGoogle() {
            const errorBox = document.getElementById('admin-login-error'); errorBox.textContent = '';
            try {
                if (!window.supabaseReady) throw new Error('Administrator sign-in is temporarily unavailable. Please try again later.');
                const { error } = await window.sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin + window.location.pathname + '?admin=1' } });
                if (error) throw error;
            } catch (err) { errorBox.textContent = err.message || 'Google sign-in failed.'; }
        }

        async function lockAdminSession() {
            isAdminLoggedIn = false; window.__snrgAdminUser = null;
            if (window.supabaseReady) await window.sb.auth.signOut().catch(console.error);
            document.getElementById('admin-modal').classList.add('hidden');
            setActiveTab('live'); showNotification('Admin session signed out.', 'info');
        }

        function toggleAdminModal() {
            document.getElementById('admin-modal').classList.toggle('hidden');
        }

        function switchAdminTab(tabName) {
            document.querySelectorAll('.admin-panel-section').forEach(el => el.classList.add('hidden'));
            document.querySelectorAll('.admin-tab-btn').forEach(btn => {
                btn.className = "admin-tab-btn bg-gray-800 text-gray-300 text-xs font-heading font-black px-3.5 py-2 rounded uppercase";
            });

            const panel = document.getElementById(`admin-panel-${tabName}`);
            if (!panel) return;
            panel.classList.remove('hidden');
            const activeBtn = document.getElementById(`adm-tab-${tabName}`);
            activeBtn.className = "admin-tab-btn bg-brand-red text-white text-xs font-heading font-black px-3.5 py-2 rounded uppercase";
            
            if (tabName === 'general') {
                document.getElementById('admin-gen-ticker').value = siteData.general.tickerText;
                document.getElementById('admin-gen-countdown-title').value = siteData.general.countdownTitle;
                document.getElementById('admin-gen-countdown-date').value = formatDateTimeLocal(siteData.general.countdownDate);
                document.getElementById('admin-gen-paysite').value = siteData.general.paysiteUrl;
            } else {
                renderAdminManagerLists();
                if (tabName === 'tickets') loadAdminTicketPurchases();
                if (tabName === 'chat') loadAdminChat();
            }
        }

        function adminSaveGeneralSettings(e) {
            e.preventDefault();
            siteData.general.tickerText = document.getElementById('admin-gen-ticker').value;
            siteData.general.countdownTitle = document.getElementById('admin-gen-countdown-title').value;
            const countdownDateInput = document.getElementById('admin-gen-countdown-date').value;
            const countdownDate = countdownDateInput ? new Date(countdownDateInput) : null;
            if (countdownDateInput && !Number.isFinite(countdownDate.getTime())) {
                showNotification("Enter a valid event date and time.", "error");
                return;
            }
            siteData.general.countdownDate = countdownDate ? countdownDate.toISOString() : '';
            siteData.general.paysiteUrl = document.getElementById('admin-gen-paysite').value;
            PAYSITE_URL = siteData.general.paysiteUrl;

            document.getElementById('header-ticker-text').innerText = siteData.general.tickerText;

            showNotification("Global site settings updated successfully!", "success");
            window.renderAllContent(); // triggers cloud persistence for authorized administrators
        }

        let countdownInterval = null;

        function formatDateTimeLocal(value) {
            if (!value) return '';
            const date = new Date(value);
            if (!Number.isFinite(date.getTime())) return '';
            const pad = part => String(part).padStart(2, '0');
            return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
        }

        function escapeHtml(value) {
            return String(value ?? '').replace(/[&<>"']/g, char => ({
                '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
            })[char]);
        }

        function getSafeHttpUrl(value, httpsOnly = false) {
            const rawUrl = String(value || '').trim();
            if (!rawUrl) return '';
            try {
                const url = new URL(rawUrl, window.location.href);
                return url.protocol === 'https:' || (!httpsOnly && url.protocol === 'http:') ? url.href : '';
            } catch {
                return '';
            }
        }

        function formatLongDate(value) {
            const date = new Date(value);
            return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/Los_Angeles' }).format(date) : '';
        }

        function formatLongDateTime(value) {
            const date = new Date(value);
            return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles' }).format(date) : '';
        }

        function updateEventCountdown() {
            const title = document.getElementById('countdown-event-title');
            const timer = document.getElementById('event-countdown');
            if (!title || !timer) return;

            const now = Date.now();
            const fallbackEventTime = new Date('2026-11-07T19:00:00-08:00').getTime();
            const fallbackEventTitle = 'FIGHT QUEST XVI · SATURDAY, NOVEMBER 7, 2026 · DOORS 6 PM · FIGHTS 7 PM';
            const nextEvent = (siteData.schedule || [])
                .filter(item => item.type === 'event' && item.eventDate && item.status === 'upcoming' && new Date(item.eventDate).getTime() > now)
                .sort((a, b) => new Date(a.eventDate).getTime() - new Date(b.eventDate).getTime())[0];
            const configuredTime = siteData.general.countdownDate ? new Date(siteData.general.countdownDate).getTime() : NaN;
            const configuredHeading = String(siteData.general.countdownTitle || '').trim();
            const configuredTimeIsFuture = Number.isFinite(configuredTime) && configuredTime > now;
            const fallbackIsFuture = Number.isFinite(fallbackEventTime) && fallbackEventTime > now;
            const doorsTime = new Date('2026-11-07T18:00:00-08:00').getTime();
            const nextEventTime = nextEvent ? new Date(nextEvent.eventDate).getTime() : NaN;
            const nextEventIsFightQuest = !!nextEvent && (
                /fight quest xvi/i.test(String(nextEvent.title || '')) ||
                (Number.isFinite(nextEventTime) && Math.abs(nextEventTime - doorsTime) < 5 * 60 * 1000)
            );
            const configuredIsFightQuest = /fight quest xvi/i.test(configuredHeading) ||
                (Number.isFinite(configuredTime) && Math.abs(configuredTime - doorsTime) < 5 * 60 * 1000);
            const usingFightQuestFallback = fallbackIsFuture && (
                nextEventIsFightQuest || (!nextEvent && configuredIsFightQuest)
            );
            const eventTime = usingFightQuestFallback
                ? fallbackEventTime
                : nextEvent ? nextEventTime
                : configuredTimeIsFuture ? configuredTime
                : fallbackIsFuture ? fallbackEventTime : NaN;
            const placeholderHeading = !configuredHeading || /coming soon|date tba/i.test(configuredHeading);

            if (countdownInterval !== null) {
                clearInterval(countdownInterval);
                countdownInterval = null;
            }

            if (!Number.isFinite(eventTime) || eventTime <= now) {
                title.textContent = 'Next fight card announcement coming soon.';
                timer.classList.add('hidden');
                return;
            }

            title.textContent = usingFightQuestFallback
                ? fallbackEventTitle
                : nextEvent
                    ? (placeholderHeading ? 'Countdown to ' + nextEvent.title + ' · ' + formatLongDate(nextEvent.eventDate) : configuredHeading)
                    : (placeholderHeading ? fallbackEventTitle : configuredHeading);
            timer.classList.remove('hidden');

            const update = () => {
                const remaining = Math.max(0, eventTime - Date.now());
                if (remaining === 0) {
                    timer.classList.add('hidden');
                    title.textContent = 'Fight Quest XVI · Doors open now · Fights begin at 7 PM.';
                    if (countdownInterval !== null) {
                        clearInterval(countdownInterval);
                        countdownInterval = null;
                    }
                    return;
                }
                document.getElementById('countdown-days').textContent = String(Math.floor(remaining / 86400000)).padStart(2, '0');
                document.getElementById('countdown-hours').textContent = String(Math.floor((remaining % 86400000) / 3600000)).padStart(2, '0');
                document.getElementById('countdown-minutes').textContent = String(Math.floor((remaining % 3600000) / 60000)).padStart(2, '0');
                document.getElementById('countdown-seconds').textContent = String(Math.floor((remaining % 60000) / 1000)).padStart(2, '0');
            };

            update();
            if (eventTime > Date.now()) countdownInterval = setInterval(update, 1000);
        }

        function verifyPromoCode() {
            openStreamCheckout({ focusPromo: true });
        }

        function cleanupExpiredPromos() {
            const todayStr = new Date().toISOString().split('T')[0];
            const initialCount = siteData.promos.length;
            siteData.promos = siteData.promos.filter(p => p.expiry >= todayStr);
            if (siteData.promos.length < initialCount) {
                showNotification("Expired promo codes automatically removed.", "info");
            }
        }

        function renderAllContent() {
            document.getElementById('header-ticker-text').textContent = siteData.general.tickerText || 'FQ MMA / TEAM S.N.R.G. MMA • OFFICIAL SITE';
            const portfolioTitle=document.getElementById('portfolio-main-title');
            if(portfolioTitle)portfolioTitle.textContent=siteData.general.portfolioTitle||'Sashsa Luv Fleskes';
            const portfolioIntro=document.getElementById('portfolio-main-intro');
            if(portfolioIntro)portfolioIntro.textContent=siteData.general.portfolioIntro||'Photography, videography, portraits, and events captured with care. Explore selected work or send a booking request to plan your session.';
            const portfolioBookingTitle=document.getElementById('portfolio-booking-title');
            if(portfolioBookingTitle)portfolioBookingTitle.textContent=siteData.general.portfolioBookingTitle||'Request a Photography or Videography Session';
            const portfolioBookingIntro=document.getElementById('portfolio-booking-intro');
            if(portfolioBookingIntro)portfolioBookingIntro.textContent=siteData.general.portfolioBookingIntro||'Send a booking request first. The team will review your request and, if approved, email you a payment or deposit link. Submitting a request does not reserve a date or require payment.';
            const portfolioBanner=document.getElementById('portfolio-banner-image');
            const featuredPortfolioImage=(siteData.portfolio||[]).find(item=>{
                const category=String(item.category||'').toLowerCase();
                const imageUrl=getSafeHttpUrl(item.image||item.imageUrl||item.file_url||'');
                return category!=='video'&&!!imageUrl;
            });
            const portfolioBannerUrl=getSafeHttpUrl(siteData.general.portfolioBannerUrl||'')||
                (featuredPortfolioImage?getSafeHttpUrl(featuredPortfolioImage.image||featuredPortfolioImage.imageUrl||featuredPortfolioImage.file_url||''):'');
            if(portfolioBanner){
                portfolioBanner.onerror=()=>{portfolioBanner.removeAttribute('src');portfolioBanner.classList.add('hidden');};
                portfolioBanner.onload=()=>portfolioBanner.classList.remove('hidden');
                if(portfolioBannerUrl){
                    portfolioBanner.src=portfolioBannerUrl;
                    portfolioBanner.loading='lazy';
                    portfolioBanner.decoding='async';
                    portfolioBanner.classList.remove('hidden');
                }else{
                    portfolioBanner.removeAttribute('src');
                    portfolioBanner.classList.add('hidden');
                }
            }
            updateEventCountdown();

            // 0. Disciplines
            const discContainer = document.getElementById('disciplines-container');
            discContainer.innerHTML = siteData.disciplines.map((d, index) => {
                const isRed = index % 2 === 0;
                const borderColor = isRed ? 'border-brand-red' : 'border-white';
                const tagColor = isRed ? 'text-brand-red bg-brand-red/20 border-red-900' : 'text-white bg-white/10 border-gray-700';
                const btnStyle = isRed ? 'bg-brand-red hover:bg-red-700 text-white' : 'bg-white hover:bg-gray-200 text-black';
                const glowStyle = isRed ? 'shadow-neon-red' : 'shadow-neon-white';

                const imageUrl = getSafeHttpUrl(d.imageUrl || d.image || '');
                const disciplineName = escapeHtml(d.name || 'Training discipline');
                const trainingUrl = getSafeHttpUrl(d.link || 'https://www.fitnessquest.com/class-schedule/auburn-mma');
                return `
                    <article class="bg-gray-900/95 rounded-2xl border-l-4 ${borderColor} border-y border-r border-gray-800 overflow-hidden flex flex-col justify-between gap-0 ${glowStyle}">
                        ${imageUrl ? `<img src="${escapeHtml(imageUrl)}" alt="${disciplineName} training" loading="lazy" referrerpolicy="no-referrer" class="w-full h-48 object-cover bg-black">` : ''}
                        <div class="p-6 space-y-4 flex flex-col flex-grow justify-between">
                          <div class="space-y-2">
                            <span class="${tagColor} text-xs font-heading font-black px-2.5 py-1 rounded uppercase tracking-wider border inline-block">Combat Discipline</span>
                            <h3 class="font-heading text-2xl font-black ${isRed ? 'text-brand-red' : 'text-white'} uppercase tracking-wide">${disciplineName}</h3>
                            <p class="text-sm text-gray-300 leading-relaxed">${escapeHtml(d.desc || '')}</p>
                          </div>
                          <div class="pt-3 border-t border-gray-800 flex items-center justify-between gap-3">
                            <span class="text-[11px] text-gray-400 font-mono">${trainingUrl ? 'Official Fitness Quest schedule' : (imageUrl ? 'Training discipline' : 'View current class schedule')}</span>
                            ${trainingUrl ? `<a href="${escapeHtml(trainingUrl)}" target="_blank" rel="noopener noreferrer" class="${btnStyle} font-heading text-xs font-black uppercase px-4 py-2 rounded-lg shadow whitespace-nowrap">View Classes & Schedule <i class="fa-solid fa-arrow-right ml-1"></i></a>` : ''}
                          </div>
                        </div>
                    </article>
                `;
            }).join('');

            if (!siteData.disciplines.length) discContainer.innerHTML = '<p class="text-center text-sm text-gray-400 md:col-span-2">No training disciplines have been published yet. Please check back soon.</p>';

            // 1. Schedule
            const schContainer = document.getElementById('schedule-container');
            schContainer.innerHTML = siteData.schedule.map((item, index) => {
                const isRed = index % 2 === 0;
                const borderColor = isRed ? 'border-brand-red' : 'border-white';
                const badgeStyle = isRed ? 'bg-brand-red/20 text-brand-red border-red-900' : 'bg-white/10 text-white border-gray-700';
                const btnStyle = isRed ? 'bg-brand-red hover:bg-red-700 text-white' : 'bg-white hover:bg-gray-200 text-black';
                const isEvent = item.type !== 'class';

                return `
                    <div class="bg-gray-900/95 p-6 rounded-xl border-l-4 ${borderColor} border-y border-r border-gray-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-lg relative group">
                        <div class="space-y-1">
                            ${isEvent && item.flyerImage ? `<img src="${escapeHtml(item.flyerImage)}" alt="${escapeHtml(item.title)} event flyer" loading="lazy" class="w-full max-w-sm rounded-lg border border-gray-700 mb-3">` : ''}
                            <span class="${badgeStyle} text-xs font-heading font-black px-2.5 py-1 rounded uppercase tracking-wider border">${escapeHtml(item.date)}</span>
                            <h3 class="font-heading text-2xl font-black text-white uppercase tracking-wide mt-1">${escapeHtml(item.title)}</h3>
                            <p class="text-xs text-gray-300">${escapeHtml(item.subtitle)}</p>
                            ${isEvent ? `<p class="font-heading text-lg font-bold text-brand-neon">${escapeHtml(item.ticketPrice || 'Live-stream access not available yet')}</p><div class="flex flex-wrap items-center gap-2 mt-3">${item.inPersonTicketUrl ? `<a href="${escapeHtml(getSafeHttpUrl(item.inPersonTicketUrl, true))}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center justify-center bg-white hover:bg-gray-200 text-black font-heading text-xs font-black uppercase px-4 py-3 rounded-lg shadow-lg"><i class="fa-solid fa-ticket mr-2" aria-hidden="true"></i>Buy In-Person Tickets</a><span class="text-xs text-gray-300">${escapeHtml(item.inPersonTicketPricing || '')}</span>` : ''}${item.streamEnabled ? `<button type="button" onclick="setActiveTab('live')" class="bg-brand-red hover:bg-red-700 text-white font-heading text-xs font-black uppercase px-4 py-3 rounded-lg shadow-lg"><i class="fa-solid fa-play mr-2" aria-hidden="true"></i>Watch Live Online · $35</button>` : ''}</div>` : ''}
                        </div>
                        <div class="flex flex-wrap items-center gap-2">
                            ${getSafeHttpUrl(item.link) ? `<a href="${escapeHtml(getSafeHttpUrl(item.link))}" target="_blank" rel="noopener noreferrer" class="${btnStyle} font-heading text-sm font-black uppercase px-6 py-3 rounded-xl shadow-lg whitespace-nowrap">Event details</a>` : ''}
                        </div>
                    </div>
                `;
            }).join('');

            if (!siteData.schedule.length) schContainer.innerHTML = `<div class="bg-gray-900/95 p-6 rounded-xl border-l-4 border-brand-red border-y border-r border-gray-800 shadow-lg"><span class="text-xs font-heading font-black uppercase tracking-wider text-brand-red">Official live schedule</span><h3 class="font-heading text-2xl font-black text-white uppercase tracking-wide mt-2">Fitness Quest Auburn MMA Classes</h3><p class="text-sm text-gray-300 mt-2 mb-4">Class times and instructors can change. Check Fitness Quest’s live Auburn MMA schedule for the latest boxing, kickboxing, jiu-jitsu, youth BJJ, and MMA class listings.</p><a href="https://www.fitnessquest.com/class-schedule/auburn-mma" target="_blank" rel="noopener noreferrer" class="inline-flex items-center justify-center bg-brand-red hover:bg-red-700 text-white font-heading text-sm font-black uppercase px-6 py-3 rounded-xl shadow-lg">View Current Class Schedule <i class="fa-solid fa-arrow-right ml-2" aria-hidden="true"></i></a><p class="text-xs text-gray-400 mt-3">Fitness Quest Auburn · 1101 Outlet Collection Way, Suite 1275, Auburn, WA 98001 · (253) 268-0625</p></div>`;

            // 2. Fighters
            const rosterContainer = document.getElementById('roster-container');
            rosterContainer.innerHTML = siteData.fighters.map((f, index) => {
                const isRed = index % 2 === 0;
                const borderColor = isRed ? 'border-brand-red' : 'border-white';
                const accentColor = isRed ? 'text-brand-red bg-brand-red/20 border-brand-red text-brand-neon' : 'text-white bg-white/10 border-white text-white';
                const badgeStyle = isRed ? 'text-brand-red bg-red-950/60 border-red-900' : 'text-white bg-white/10 border-gray-700';

                return `
                    <div class="bg-gray-900/95 p-6 rounded-xl border-l-4 ${borderColor} border-y border-r border-gray-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-lg">
                        <div class="flex items-center gap-4">
                            <div class="w-14 h-14 rounded-full ${accentColor} border-2 flex items-center justify-center font-heading font-black text-xl shrink-0 overflow-hidden">
                                ${f.image && /^https:\/\/[a-z0-9.-]+(?:\/[^\s"'<>]*)?$/i.test(f.image) ? '<img src="' + f.image + '" alt="' + f.name + '" class="w-full h-full object-cover rounded-full">' : (f.initials || f.name.substring(0,2).toUpperCase())}
                            </div>
                            <div class="space-y-1">
                                <span class="${isRed ? 'text-brand-red' : 'text-white'} font-heading font-black text-xs tracking-widest uppercase">${f.record}</span>
                                <h3 class="font-heading text-2xl font-black text-white uppercase tracking-wide">${f.name}</h3>
                                <p class="text-xs text-gray-300">${f.desc}</p>
                            </div>
                        </div>
                        <div>
                            <span class="${badgeStyle} font-heading font-extrabold text-xs uppercase px-3 py-1.5 rounded border">Athlete</span>
                        </div>
                    </div>
                `;
            }).join('');

            if (!siteData.fighters.length) rosterContainer.innerHTML = '<div class="md:col-span-2 rounded-xl border border-gray-800 bg-gray-900/90 p-6 text-center"><p class="font-heading text-lg font-black uppercase tracking-wide text-white">Fight Quest XVI athlete profiles are being confirmed</p><p class="mt-2 text-sm text-gray-300">Official fighter profiles will appear here once the event team publishes the confirmed lineup.</p><a href="#contact" class="mt-4 inline-flex rounded-lg bg-brand-red px-5 py-3 text-xs font-black uppercase text-white hover:bg-red-700">Contact the Event Team</a></div>';

            // 3. Store
            const storeContainer = document.getElementById('store-container');
            storeContainer.innerHTML = siteData.store.map((s, index) => {
                const isRed = index % 2 === 0;
                const borderColor = isRed ? 'border-brand-red' : 'border-white';
                const tagColor = isRed ? 'text-brand-red' : 'text-white';
                const btnStyle = isRed ? 'bg-brand-red hover:bg-red-700 text-white' : 'bg-white hover:bg-gray-200 text-black';
                const productUrl = getSafeHttpUrl(s.link, true);
                const imageUrl = getSafeHttpUrl(s.image, true);

                return `
                    <div class="bg-gray-900/95 p-6 rounded-xl border-l-4 ${borderColor} border-y border-r border-gray-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-lg">
                        <div class="space-y-1">
                            ${imageUrl ? '<img src="' + escapeHtml(imageUrl) + '" alt="' + escapeHtml(s.title || 'FQ MMA product') + '" loading="lazy" class="w-full max-h-48 object-cover rounded-lg mb-3">' : ''}
                            <span class="${tagColor} font-heading font-black text-xs tracking-widest uppercase">FQ MMA PRODUCT</span>
                            <h3 class="font-heading text-2xl font-black text-white uppercase tracking-wide">${escapeHtml(s.title)}</h3>
                            <p class="text-xs text-gray-300">${escapeHtml(s.subtitle)}</p>
                        </div>
                        <div class="flex items-center gap-4 w-full sm:w-auto justify-between sm:justify-end">
                            <span class="font-heading text-2xl font-black ${isRed ? 'text-brand-neon' : 'text-white'}">${escapeHtml(s.price)}</span>
                            <button type="button" data-product-url="${escapeHtml(productUrl)}" class="${btnStyle} text-xs font-black uppercase px-5 py-2.5 rounded-lg shadow-lg" ${productUrl ? '' : 'disabled aria-disabled="true"'}>Buy Now</button>
                        </div>
                    </div>
                `;
            }).join('');
            storeContainer.onclick = event => {
                const button = event.target.closest('[data-product-url]');
                if (button && button.dataset.productUrl) openCustomLink(button.dataset.productUrl);
            };

            if (!siteData.store.length) storeContainer.innerHTML = '<div class="md:col-span-2 rounded-xl border border-gray-800 bg-gray-900/90 p-6 text-center"><i class="fa-solid fa-store text-2xl text-brand-red" aria-hidden="true"></i><h3 class="mt-3 font-heading text-xl font-black uppercase tracking-wide text-white">Merchandise listings are being prepared</h3><p class="mt-2 text-sm text-gray-300">There are no merchandise products published in the store right now. Event ticket and live-stream options are listed separately under Schedule &amp; Tickets.</p><button type="button" onclick="setActiveTab(\'schedule\')" class="mt-4 inline-flex rounded-lg bg-brand-red px-5 py-3 text-xs font-black uppercase text-white hover:bg-red-700">View Schedule &amp; Tickets</button></div>';

            // 4. Separate public catalogs: FQ MMA event media and Sasha's portfolio.
            const renderMediaCards = (items, container, emptyMessage) => {
                // Keep published records and prices intact, but do not show public cards without a safe preview.
                const visibleItems = (Array.isArray(items) ? items : []).filter(item => !!getSafeHttpUrl(item.image, true));
                container.innerHTML = visibleItems.map((item, index) => {
                    const isRed = index % 2 === 0;
                    const borderColor = isRed ? 'border-brand-red' : 'border-white';
                    const glowStyle = isRed ? 'shadow-neon-red' : 'shadow-neon-white';
                    // Public listings may show photos, but never embed a public video preview.
                    // Paid originals stay private and are delivered only after Stripe confirms payment.
                    const safeListing = !!(item.mediaId && item.protectedMedia === true);
                    const isVideo = String(item.category || '').toLowerCase() === 'video';
                    const mediaUrl = safeListing ? getSafeHttpUrl(item.image, true) : '';
                    const itemUrl = safeListing ? getSafeHttpUrl(item.link, true) : '';
                    const isPaid = Number(item.priceAmount || 0) > 0 && item.priceConfirmed === true;
                    const downloadUrl = safeListing && !isPaid ? itemUrl : '';
                    const media = isVideo
                        ? (mediaUrl ? `<img src="${escapeHtml(mediaUrl)}" alt="${escapeHtml(item.title || 'Video')} thumbnail" loading="lazy" class="w-full max-h-72 object-cover rounded-lg">` : `<div class="w-full min-h-48 flex flex-col items-center justify-center rounded-lg border border-gray-700 bg-gradient-to-br from-gray-950 via-gray-900 to-red-950 text-center p-6"><i class="fa-solid fa-circle-play text-4xl text-brand-red mb-3" aria-hidden="true"></i><span class="text-xs font-black uppercase tracking-widest text-brand-red">FQ · Team S.N.R.G.</span><span class="font-heading text-2xl font-black uppercase text-white mt-2">${escapeHtml(item.title || 'Fight video')}</span><span class="text-xs uppercase tracking-widest text-gray-400 mt-2">Preview unavailable</span></div>`)
                        : (mediaUrl ? `<img src="${escapeHtml(mediaUrl)}" alt="${escapeHtml(item.title || 'Photo listing image')}" loading="lazy" class="w-full max-h-72 object-cover rounded-lg">` : '');
                    const contactForPrice = !isPaid;
                    const action = isPaid
                        ? `<button type="button" data-buy-media="${Number(item.mediaId)}" data-media-title="${escapeHtml(item.title || 'digital media')}" class="inline-flex rounded-lg px-4 py-2 text-xs font-black uppercase ${isRed ? 'bg-brand-red text-white hover:bg-red-700' : 'bg-white text-black hover:bg-gray-200'}">${isVideo ? 'Purchase secure video access' : 'Purchase digital media'}</button>`
                        : `<button type="button" data-contact-pricing="true" data-media-title="${escapeHtml(item.title || 'digital media')}" data-media-collection="${item.collection === 'sasha_portfolio' ? 'photography' : 'MMA media'}" class="inline-flex rounded-lg px-4 py-2 text-xs font-black uppercase transition-all ${isRed ? 'bg-brand-red text-white hover:bg-red-700 hover:shadow-neon-red' : 'bg-white text-black hover:bg-gray-200'}">Ask about pricing</button>`;
                    return `
                        <article class="bg-gray-900/95 p-5 rounded-2xl border-l-4 ${borderColor} border-y border-r border-gray-800 space-y-3 ${glowStyle}">
                            ${media}
                            <div class="flex items-start justify-between gap-3">
                                <div>
                                    <p class="text-xs font-black uppercase tracking-widest ${isRed ? 'text-brand-red' : 'text-white'}">${escapeHtml(item.category || 'Media')}</p>
                                    <h3 class="font-heading text-xl font-black text-white uppercase">${escapeHtml(item.title || 'Untitled media')}</h3>
                                    ${item.eventTitle ? `<p class="text-xs text-brand-red mt-1">Event: ${escapeHtml(item.eventTitle)}</p>` : ''}
                                    ${item.description ? `<p class="text-sm text-gray-400 mt-2">${escapeHtml(item.description)}</p>` : ''}
                                </div>
                                <span class="shrink-0 font-heading font-bold ${isRed ? 'text-brand-neon' : 'text-white'}">${isPaid ? escapeHtml(item.price || 'One-time purchase') : 'Price available on request'}</span>
                            </div>
                            ${action}
                        </article>
                    `;
                }).join('');
                if (visibleItems.length === 0) container.innerHTML = `<p class="text-center text-sm text-gray-400 md:col-span-2">${emptyMessage || 'New photos and videos will appear here when preview images are available.'}</p>`;
            };
            // Legacy free-form links stay hidden until they are re-uploaded through the protected media workflow.
            const uniqueMediaCards = (items) => {
                const seen = new Set();
                return items.filter(item => {
                    const key = [String(item.title || '').trim().toLowerCase(), String(item.category || '').trim().toLowerCase(), String(item.collection || '').trim().toLowerCase()].join('|');
                    if (seen.has(key)) return false;
                    seen.add(key);
                    return true;
                });
            };
            const mmaMedia = uniqueMediaCards(siteData.portfolio.filter(item => item.mediaId && item.protectedMedia === true && item.mediaDestination !== 'portfolio' && item.collection !== 'sasha_portfolio'));
            const sashaMedia = uniqueMediaCards(siteData.portfolio.filter(item => item.mediaId && item.protectedMedia === true && (item.mediaDestination === 'portfolio' || item.collection === 'sasha_portfolio')));
            renderMediaCards(mmaMedia, document.getElementById('mma-event-media-container'), 'New MMA event photos and videos will appear here when available.');
            renderMediaCards(sashaMedia, document.getElementById('sasha-portfolio-container'), 'New Sasha portfolio photos and videos will appear here when available.');
            syncPublicTabs();

        }

        function renderAdminManagerLists() {
            const admDisc = document.getElementById('admin-list-disciplines');
            if(admDisc) {
                admDisc.innerHTML = siteData.disciplines.length ? siteData.disciplines.map(item => `
                    <div class="bg-black p-3 rounded border border-gray-800 flex items-center justify-between text-xs gap-2">
                        <div class="truncate">
                            <span class="text-white font-bold">${item.name}</span> <span class="text-gray-500 text-[10px]">(${item.link})</span>
                        </div>
                        <div class="flex gap-2 shrink-0">
                            <button onclick="adminEditDiscipline(${item.id})" class="text-blue-400 hover:text-blue-300 px-2 py-1"><i class="fa-solid fa-pen"></i></button>
                            <button onclick="adminDeleteItem('disciplines', ${item.id})" class="text-red-400 hover:text-red-300 px-2 py-1"><i class="fa-solid fa-trash"></i></button>
                        </div>
                    </div>
                `).join('') : '<p class="text-xs text-gray-400 p-3">No disciplines yet. Add one using the form above.</p>';
            }

            const admSch = document.getElementById('admin-list-schedule');
            if(admSch) {
                admSch.innerHTML = siteData.schedule.length ? siteData.schedule.map(item => `
                    <div class="bg-black p-3 rounded border border-gray-800 flex items-center justify-between text-xs gap-2">
                        <div class="truncate">
                            <span class="text-brand-red font-bold">${escapeHtml(item.date)}</span> - <span class="text-white font-bold">${escapeHtml(item.title)}</span> <span class="text-brand-neon">${escapeHtml(item.ticketPrice || 'Price TBA')}</span> <span class="text-gray-500 text-[10px]">(${escapeHtml(item.link)})</span>
                        </div>
                        <div class="flex gap-2 shrink-0">
                            <button onclick="adminEditSchedule(${item.id})" class="text-blue-400 hover:text-blue-300 px-2 py-1"><i class="fa-solid fa-pen"></i></button>
                            <button onclick="adminDeleteItem('schedule', ${item.id})" class="text-red-400 hover:text-red-300 px-2 py-1"><i class="fa-solid fa-trash"></i></button>
                        </div>
                    </div>
                `).join('') : '<p class="text-xs text-gray-400 p-3">No events or training sessions yet. Add one using the form above.</p>';
            }

            const admF = document.getElementById('admin-list-fighters');
            if(admF) {
                admF.innerHTML = siteData.fighters.length ? siteData.fighters.map(item => `
                    <div class="bg-black p-3 rounded border border-gray-800 flex items-center justify-between text-xs gap-2">
                        <div class="truncate">
                            <span class="text-white font-bold">${item.name}</span> (${item.record})
                        </div>
                        <div class="flex gap-2 shrink-0">
                            <button onclick="adminEditFighter(${item.id})" class="text-blue-400 hover:text-blue-300 px-2 py-1"><i class="fa-solid fa-pen"></i></button>
                            <button onclick="adminDeleteItem('fighters', ${item.id})" class="text-red-400 hover:text-red-300 px-2 py-1"><i class="fa-solid fa-trash"></i></button>
                        </div>
                    </div>
                `).join('') : '<p class="text-xs text-gray-400 p-3">No fighter profiles yet. Add one using the form above.</p>';
            }

            const admS = document.getElementById('admin-list-store');
            if(admS) {
                admS.innerHTML = siteData.store.length ? siteData.store.map(item => `
                    <div class="bg-black p-3 rounded border border-gray-800 flex items-center justify-between text-xs gap-2">
                        <div class="truncate">
                            <span class="text-white font-bold">${item.title}</span> - <span class="text-brand-neon">${item.price}</span> <span class="text-gray-500 text-[10px]">(${item.link})</span>
                        </div>
                        <div class="flex gap-2 shrink-0">
                            <button onclick="adminEditStore(${item.id})" class="text-blue-400 hover:text-blue-300 px-2 py-1"><i class="fa-solid fa-pen"></i></button>
                            <button onclick="adminDeleteItem('store', ${item.id})" class="text-red-400 hover:text-red-300 px-2 py-1"><i class="fa-solid fa-trash"></i></button>
                        </div>
                    </div>
                `).join('') : '<p class="text-xs text-gray-400 p-3">No store items yet. Add one using the form above.</p>';
            }

            const admP = document.getElementById('admin-list-portfolio');
            if(admP) {
                admP.innerHTML = siteData.portfolio.length ? siteData.portfolio.map(item => `
                    <div class="bg-black p-3 rounded border border-gray-800 flex items-center justify-between text-xs gap-2">
                        <div class="truncate">
                            <span class="text-white font-bold">${item.title}</span> - <span class="text-brand-neon">${item.price || 'Free'}</span> <span class="text-gray-500 text-[10px]">(${item.link})</span>
                        </div>
                        <div class="flex gap-2 shrink-0">
                            <button onclick="adminEditPortfolio(${item.id})" class="text-blue-400 hover:text-blue-300 px-2 py-1"><i class="fa-solid fa-pen"></i></button>
                            <button onclick="adminDeleteItem('portfolio', ${item.id})" class="text-red-400 hover:text-red-300 px-2 py-1"><i class="fa-solid fa-trash"></i></button>
                        </div>
                    </div>
                `).join('') : '<p class="text-xs text-gray-400 p-3">No media or portfolio items yet. Add or upload media to populate this list.</p>';
            }

            const admPromos = document.getElementById('admin-list-promos');
            if(admPromos) {
                admPromos.innerHTML = siteData.promos.length ? siteData.promos.map(item => `
                    <div class="bg-black p-3 rounded border border-gray-800 flex items-center justify-between text-xs gap-2">
                        <div class="truncate">
                            <span class="text-brand-neon font-mono font-bold">${item.code}</span> (${item.event}) — Expires: <span class="text-gray-300">${item.expiry}</span>
                        </div>
                        <div class="flex gap-2 shrink-0">
                            <button onclick="adminEditPromoCode(${item.id})" class="text-blue-400 hover:text-blue-300 px-2 py-1"><i class="fa-solid fa-pen"></i></button>
                            <button onclick="adminDeleteItem('promos', ${item.id})" class="text-red-400 hover:text-red-300 px-2 py-1"><i class="fa-solid fa-trash"></i></button>
                        </div>
                    </div>
                `).join('') : '<p class="text-xs text-gray-400 p-3">No promotion codes yet. Create one when a promotion is ready.</p>';
            }
        }

        function adminSaveDiscipline(e) {
            e.preventDefault();
            const id = document.getElementById('edit-disc-id').value;
            const name = document.getElementById('admin-disc-name').value;
            const desc = document.getElementById('admin-disc-desc').value;
            const link = document.getElementById('admin-disc-link').value.trim();
            const imageUrl = document.getElementById('admin-disc-image').value.trim();
            if (imageUrl && (!getSafeHttpUrl(imageUrl) || !imageUrl.startsWith('https://'))) { showNotification("Use a valid HTTPS image URL.", "error"); return; }

            if (id) {
                const item = siteData.disciplines.find(d => d.id == id);
                if (item) { item.name = name; item.desc = desc; item.link = link; item.imageUrl = imageUrl; }
                showNotification("Discipline Updated Successfully!", "success");
            } else {
                siteData.disciplines.push({ id: Date.now(), name, desc, link, imageUrl });
                showNotification("Discipline Added Successfully!", "success");
            }
            document.getElementById('edit-disc-id').value = '';
            document.getElementById('disc-form-title').innerText = "➕ Add / Edit Discipline & Training Link";
            document.getElementById('disc-submit-btn').innerText = "Save Discipline";
            e.target.reset();
            siteData.disciplineDefaultsVersion = 2;
            window.renderAllContent();
            renderAdminManagerLists();
        }

        function adminEditDiscipline(id) {
            const item = siteData.disciplines.find(d => d.id == id);
            if (item) {
                document.getElementById('edit-disc-id').value = item.id;
                document.getElementById('admin-disc-name').value = item.name;
                document.getElementById('admin-disc-desc').value = item.desc;
                document.getElementById('admin-disc-link').value = item.link || '';
                document.getElementById('admin-disc-image').value = item.imageUrl || item.image || '';
                document.getElementById('disc-form-title').innerText = "✏️ Edit Discipline & Training Link";
                document.getElementById('disc-submit-btn').innerText = "Update Discipline";
            }
        }

        function adminSaveSchedule(e) {
            e.preventDefault();
            const id = document.getElementById('edit-sch-id').value;
            const date = document.getElementById('admin-sch-date').value;
            const title = document.getElementById('admin-sch-title').value;
            const ticketPrice = document.getElementById('admin-sch-ticket-price').value.trim();
            const link = document.getElementById('admin-sch-link').value;

            if (id) {
                const item = siteData.schedule.find(s => s.id == id);
                if (item) { item.date = date; item.title = title; item.ticketPrice = ticketPrice; item.link = link; }
                showNotification("Schedule Event Updated!", "success");
            } else {
                siteData.schedule.push({ id: Date.now(), type: 'event', date, title, subtitle: "Fitness Quest Arena • Multi-Discipline Championships", ticketPrice, link });
                showNotification("Schedule Event Added!", "success");
            }
            document.getElementById('edit-sch-id').value = '';
            document.getElementById('sch-form-title').innerText = "➕ Add / Edit Fight Schedule & Tickets";
            document.getElementById('sch-submit-btn').innerText = "Save Event";
            e.target.reset();
            window.renderAllContent();
            renderAdminManagerLists();
        }

        function adminEditSchedule(id) {
            const item = siteData.schedule.find(s => s.id == id);
            if (item) {
                document.getElementById('edit-sch-id').value = item.id;
                document.getElementById('admin-sch-date').value = item.date;
                document.getElementById('admin-sch-title').value = item.title;
                document.getElementById('admin-sch-ticket-price').value = item.ticketPrice || '';
                document.getElementById('admin-sch-link').value = item.link || PAYSITE_URL;
                document.getElementById('sch-form-title').innerText = "✏️ Edit Fight Schedule Event";
                document.getElementById('sch-submit-btn').innerText = "Update Event";
            }
        }

        function adminSaveFighter(e) {
            e.preventDefault();
            const id = document.getElementById('edit-fighter-id').value;
            const name = document.getElementById('admin-f-name').value;
            const record = document.getElementById('admin-f-record').value;
            const desc = document.getElementById('admin-f-desc').value;

            if (id) {
                const item = siteData.fighters.find(f => f.id == id);
                if (item) { item.name = name; item.record = record; item.desc = desc; item.initials = name.substring(0,2).toUpperCase(); }
                showNotification("Athlete Profile Updated!", "success");
            } else {
                siteData.fighters.push({ id: Date.now(), name, record, desc, initials: name.substring(0,2).toUpperCase() });
                showNotification("Athlete Added!", "success");
            }
            document.getElementById('edit-fighter-id').value = '';
            document.getElementById('fighter-form-title').innerText = "➕ Add / Edit Fighter Profile";
            document.getElementById('fighter-submit-btn').innerText = "Save Fighter";
            e.target.reset();
            window.renderAllContent();
            renderAdminManagerLists();
        }

        function adminEditFighter(id) {
            const item = siteData.fighters.find(f => f.id == id);
            if (item) {
                document.getElementById('edit-fighter-id').value = item.id;
                document.getElementById('admin-f-name').value = item.name;
                document.getElementById('admin-f-record').value = item.record;
                document.getElementById('admin-f-desc').value = item.desc;
                document.getElementById('fighter-form-title').innerText = "✏️ Edit Fighter Profile";
                document.getElementById('fighter-submit-btn').innerText = "Update Fighter";
            }
        }

        function adminSaveStore(e) {
            e.preventDefault();
            const id = document.getElementById('edit-store-id').value;
            const title = document.getElementById('admin-store-title').value;
            const price = document.getElementById('admin-store-price').value;
            const link = document.getElementById('admin-store-link').value;

            if (id) {
                const item = siteData.store.find(s => s.id == id);
                if (item) { item.title = title; item.price = price; item.link = link; }
                showNotification("Store Product Updated!", "success");
            } else {
                siteData.store.push({ id: Date.now(), title, subtitle: "Official S.N.R.G. digital package download.", price, link });
                showNotification("Store Product Added!", "success");
            }
            document.getElementById('edit-store-id').value = '';
            document.getElementById('store-form-title').innerText = "➕ Add / Edit Store Product & Price";
            document.getElementById('store-submit-btn').innerText = "Save Product";
            e.target.reset();
            window.renderAllContent();
            renderAdminManagerLists();
        }

        function adminEditStore(id) {
            const item = siteData.store.find(s => s.id == id);
            if (item) {
                document.getElementById('edit-store-id').value = item.id;
                document.getElementById('admin-store-title').value = item.title;
                document.getElementById('admin-store-price').value = item.price;
                document.getElementById('admin-store-link').value = item.link || PAYSITE_URL;
                document.getElementById('store-form-title').innerText = "✏️ Edit Store Product";
                document.getElementById('store-submit-btn').innerText = "Update Product";
            }
        }

        function adminSavePortfolio(e) {
            e.preventDefault();
            const id = document.getElementById('edit-port-id').value;
            const title = document.getElementById('admin-port-title').value;
            const price = document.getElementById('admin-port-price').value;
            const image = document.getElementById('admin-port-url').value;
            const link = document.getElementById('admin-port-link').value;

            if (id) {
                const item = siteData.portfolio.find(p => p.id == id);
                if (item) { item.title = title; item.price = price; item.image = image; item.link = link; }
                showNotification("Portfolio Item Updated!", "success");
            } else {
                siteData.portfolio.unshift({ id: Date.now(), title, category: "MMA Bout", price, image, link });
                showNotification("Portfolio Item Added!", "success");
            }
            document.getElementById('edit-port-id').value = '';
            document.getElementById('port-form-title').innerText = "➕ Add / Edit Portfolio Item & Pricing";
            document.getElementById('port-submit-btn').innerText = "Save Media";
            e.target.reset();
            window.renderAllContent();
            renderAdminManagerLists();
        }

        function adminEditPortfolio(id) {
            const item = siteData.portfolio.find(p => p.id == id);
            if (item) {
                document.getElementById('edit-port-id').value = item.id;
                document.getElementById('admin-port-title').value = item.title;
                document.getElementById('admin-port-price').value = item.price || "Free";
                document.getElementById('admin-port-url').value = item.image;
                document.getElementById('admin-port-link').value = item.link || PAYSITE_URL;
                document.getElementById('port-form-title').innerText = "✏️ Edit Portfolio Item & Pricing";
                document.getElementById('port-submit-btn').innerText = "Update Media";
            }
        }

        function adminSavePromoCode(e) {
            e.preventDefault();
            const id = document.getElementById('edit-promo-id').value;
            const codeInput = document.getElementById('promo-code-text').value.trim().toUpperCase();
            const eventName = document.getElementById('promo-event-name').value.trim();
            const expiryDate = document.getElementById('promo-expiry-date').value;

            if(!expiryDate) {
                showNotification("Please select an expiry date.", "error");
                return;
            }

            if (id) {
                const item = siteData.promos.find(p => p.id == id);
                if (item) {
                    item.code = codeInput;
                    item.event = eventName;
                    item.expiry = expiryDate;
                }
                showNotification("Promo Code Updated Successfully!", "success");
            } else {
                siteData.promos.push({
                    id: Date.now(),
                    code: codeInput || `SNRG-${Math.floor(1000 + Math.random() * 9000)}`,
                    event: eventName,
                    expiry: expiryDate
                });
                showNotification("New Promo Code Created Successfully!", "success");
            }

            document.getElementById('edit-promo-id').value = '';
            document.getElementById('promo-code-text').value = '';
            document.getElementById('promo-form-title').innerText = "🎟️ Generate & Edit Fight Promo Code";
            document.getElementById('promo-submit-btn').innerText = "Save Promo Code";
            e.target.reset();
            renderAdminManagerLists();
        }

        function adminEditPromoCode(id) {
            const item = siteData.promos.find(p => p.id == id);
            if (item) {
                document.getElementById('edit-promo-id').value = item.id;
                document.getElementById('promo-code-text').value = item.code;
                document.getElementById('promo-event-name').value = item.event;
                document.getElementById('promo-expiry-date').value = item.expiry;
                document.getElementById('promo-form-title').innerText = "✏️ Edit Promo Code";
                document.getElementById('promo-submit-btn').innerText = "Update Promo Code";
            }
        }

        function adminDeleteItem(category, id) {
            siteData[category] = siteData[category].filter(item => item.id !== id);
            window.renderAllContent();
            renderAdminManagerLists();
            showNotification("Item removed successfully.", "info");
        }

        function adminResetDefaults() {
            window.location.reload();
        }

        const publicTabHashes = { live: 'main-content', schedule: 'schedule', fighters: 'roster', disciplines: 'disciplines', store: 'media', portfolio: 'sasha-work', contact: 'contact' };
        function getPublicTabAvailability() {
            // Keep the public navigation stable even when a section has no published records yet.
            // Empty sections already have explanatory copy or an empty-state container, and hiding
            // their navigation items makes the menu shift unexpectedly between visits.
            return { live: true, schedule: true, fighters: true, disciplines: true, store: true, portfolio: true, contact: true };
        }
        function syncPublicTabs() {
            const available = getPublicTabAvailability();
            document.querySelectorAll('header nav .nav-btn').forEach((button) => {
                const id = button.dataset.tab || (button.id.startsWith('nav-') ? button.id.slice(4) : '');
                if (!id || !(id in available)) return;
                button.classList.toggle('hidden', !available[id]);
                button.setAttribute('aria-hidden', String(!available[id]));
                button.tabIndex = available[id] ? 0 : -1;
            });
            document.querySelectorAll('.tab-content').forEach((panel) => {
                const id = panel.id.replace(/^tab-/, '');
                if (id in available && !available[id]) panel.classList.add('hidden');
            });
            const active = document.querySelector('.tab-content:not(.hidden)');
            if (active && available[active.id.replace(/^tab-/, '')] === false) {
                const next = Object.keys(available).find((id) => available[id]);
                if (next) setActiveTab(next, false);
            }
        }
        function ensurePublicNavigation() {
            const tabs = [
                { id: 'live', hash: 'main-content', label: 'Live Stream' },
                { id: 'disciplines', hash: 'disciplines', label: 'Disciplines' },
                { id: 'schedule', hash: 'schedule', label: 'Events' },
                { id: 'fighters', hash: 'roster', label: 'Roster' },
                { id: 'store', hash: 'media', label: 'Media' },
                { id: 'portfolio', hash: 'sasha-work', label: 'Sasha Portfolio' },
                { id: 'contact', hash: 'contact', label: 'Contact' }
            ];
            document.querySelectorAll('header nav[aria-label="Main navigation"], header nav[aria-label="Mobile navigation"]').forEach(nav => {
                const mobile = nav.getAttribute('aria-label') === 'Mobile navigation';
                if (!nav.querySelector('.nav-btn')) {
                    nav.innerHTML = tabs.map(tab => {
                        const click = tab.id === 'portfolio'
                            ? "goToSashaWork(); return false;"
                            : "setActiveTab('" + tab.id + "'); return false;";
                        const className = mobile
                            ? 'nav-btn shrink-0 rounded-md px-3 py-2 text-xs font-bold uppercase text-gray-300'
                            : 'nav-btn px-3 py-2 rounded-md font-heading text-sm tracking-wider uppercase font-extrabold text-gray-300';
                        return '<a href="#' + tab.hash + '" aria-controls="tab-' + tab.id + '" data-tab="' + tab.id + '"' +
                            (mobile ? '' : ' id="nav-' + tab.id + '"') +
                            ' onclick="' + click + '" class="' + className + '">' + tab.label + '</a>';
                    }).join('');
                }
                if (!nav.querySelector('[data-sasha-full-portfolio]')) {
                    const link = document.createElement('a');
                    link.href = '/sasha.html';
                    link.textContent = 'Full Sasha Portfolio ↗';
                    link.setAttribute('data-sasha-full-portfolio', 'true');
                    link.setAttribute('aria-label', 'Open Sasha’s full photography and videography portfolio');
                    link.className = mobile
                        ? 'nav-external-link shrink-0 rounded-md px-3 py-2 text-xs font-bold uppercase text-brand-neon underline'
                        : 'nav-external-link inline-flex items-center px-3 py-2 rounded-md font-heading text-xs tracking-wider uppercase font-extrabold text-brand-neon hover:text-white hover:bg-white/5 transition-all border border-gray-700';
                    nav.appendChild(link);
                }
            });
        }

        function tabFromHash(hash) {
            const slug = String(hash || '').replace(/^#/, '');
            const aliases = {
                'main-content': 'live',
                'live-stream': 'live',
                'tab-schedule': 'schedule',
                'schedule': 'schedule',
                'events': 'schedule',
                'roster': 'fighters',
                'media': 'store',
                'portfolio': 'portfolio',
                'sasha-work': 'portfolio'
            };
            if (aliases[slug]) return aliases[slug];
            return Object.keys(publicTabHashes).find((id) => publicTabHashes[id] === slug || id === slug) || '';
        }
        function setActiveTab(tabId, updateHash = true) {
            const available = getPublicTabAvailability();
            const activeTab = document.getElementById(`tab-${tabId}`);
            if (!activeTab || available[tabId] === false) return;
            document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
            activeTab.classList.remove('hidden');
            document.querySelectorAll('header nav .nav-btn').forEach(btn => {
                btn.classList.remove('text-brand-red', 'bg-brand-red/10', 'border', 'border-brand-red/30');
                btn.classList.add('text-gray-300');
                btn.setAttribute('aria-current', 'false');
                if (btn.id === `nav-${tabId}` || btn.dataset.tab === tabId) {
                    btn.classList.remove('text-gray-300');
                    btn.classList.add('text-brand-red', 'bg-brand-red/10', 'border', 'border-brand-red/30');
                    btn.setAttribute('aria-current', 'page');
                }
            });
            if (updateHash && publicTabHashes[tabId]) window.history.replaceState(null, '', window.location.pathname + window.location.search + '#' + publicTabHashes[tabId]);
            const main = document.getElementById('main-content');
            if (main && document.activeElement && document.activeElement.closest && document.activeElement.closest('header nav')) {
                main.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
            }
        }

        function goToSashaWork() {
            setActiveTab('portfolio', false);
            window.history.replaceState(null, '', window.location.pathname + window.location.search + '#sasha-work');
            window.setTimeout(() => {
                const work = document.getElementById('sasha-work');
                if (work) work.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
            }, 60);
        }

        async function submitBookingRequest(event) {
            event.preventDefault();
            const form = event.currentTarget;
            const status = document.getElementById('booking-status');
            const button = document.getElementById('booking-submit');
            const honeypot = document.getElementById('booking-company').value.trim();
            if (honeypot) return;
            const name = document.getElementById('booking-name').value.trim();
            const email = document.getElementById('booking-email').value.trim();
            const phone = document.getElementById('booking-phone').value.trim();
            const service = document.getElementById('booking-service').value;
            const date = document.getElementById('booking-date').value || null;
            const time = document.getElementById('booking-time').value.trim();
            const location = document.getElementById('booking-location').value.trim();
            const details = document.getElementById('booking-details').value.trim();
            if (!name || !email || !service || !details) { status.textContent = 'Please complete every required field.'; status.className = 'text-sm text-red-400'; return; }
            if (!window.sb || !window.supabaseReady) { status.textContent = 'The booking service is temporarily unavailable. Please try again later.'; status.className = 'text-sm text-red-400'; return; }
            button.disabled = true; button.textContent = 'Submitting…'; status.textContent = 'Submitting your request securely…'; status.className = 'text-sm text-gray-400';
            try {
                const { data, error } = await window.sb.functions.invoke('create-booking-request', { body: { name, email, phone, service, date, time, location, details, company: honeypot } });
                if (error) throw error;
                if (!data?.success) throw new Error(data?.error || 'The request could not be submitted.');
                status.textContent = data.notified ? 'Request received! The team has been notified. Your date is not confirmed until the request is approved.' : 'Your request was received. The team will review it; your date is not confirmed until approved.';
                status.className = 'text-sm text-emerald-400';
                form.reset();
            } catch (error) {
                console.error('Booking request submission failed.', error);
                status.textContent = 'We could not submit your request. Please try again in a few minutes.';
                status.className = 'text-sm text-red-400';
            } finally { button.disabled = false; button.textContent = 'Send booking request'; }
        }
        document.getElementById('booking-request-form')?.addEventListener('submit', submitBookingRequest);

        async function submitSupportInquiry(event) {
            event.preventDefault();
            const form = event.currentTarget;
            const status = document.getElementById('contact-status');
            const button = document.getElementById('contact-submit');
            const name = document.getElementById('contact-name').value.trim();
            const email = document.getElementById('contact-email').value.trim();
            const category = document.getElementById('contact-category').value;
            const message = document.getElementById('contact-message').value.trim();
            const honeypot = document.getElementById('contact-company').value.trim();

            if (honeypot) return;
            if (!name || !email || !category || !message) {
                status.textContent = 'Please complete every field before sending.';
                status.className = 'text-sm text-red-400';
                return;
            }
            if (message.length > 5000 || name.length > 120 || email.length > 254) {
                status.textContent = 'Please shorten your name, email address, or message and try again.';
                status.className = 'text-sm text-red-400';
                return;
            }
            if (!window.sb || !window.supabaseReady) {
                status.textContent = 'The contact service is temporarily unavailable. Please try again later.';
                status.className = 'text-sm text-red-400';
                return;
            }

            button.disabled = true;
            button.textContent = 'Sending…';
            status.textContent = 'Sending your message securely…';
            status.className = 'text-sm text-gray-400';
            try {
                const { data, error } = await window.sb.functions.invoke('send-contact-message', {
                    body: { name, email, category, message, company: honeypot }
                });
                if (error) throw error;
                if (!data?.success) throw new Error(data?.error || 'The message could not be sent.');
                status.textContent = 'Message sent! The FQ MMA team will be in touch.';
                status.className = 'text-sm text-emerald-400';
                form.reset();
            } catch (error) {
                console.error('Contact form submission failed.', error);
                const errorMessage = String(error?.message || '');
                const statusCode = error?.context?.status;
                status.textContent = (statusCode === 429 || errorMessage.includes('Too many messages'))
                    ? 'Too many messages have been sent. Please wait before trying again.'
                    : ((errorMessage.includes('RESEND_API_KEY') || errorMessage.includes('CONTACT_FROM_EMAIL'))
                        ? 'The contact form is temporarily unavailable. Please try again later.'
                        : 'We could not send your message right now. Please try again in a few minutes.');
                status.className = 'text-sm text-red-400';
            } finally {
                button.disabled = false;
                button.textContent = 'Send Message';
            }
        }

        function scrollToPPV() {
            setActiveTab('live');
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }

        function getFanChatSettings() {
            const settings=window.siteData?.general?.liveChat;
            return settings&&typeof settings==='object'?settings:{enabled:true,mode:'manual',offlineMessages:[]};
        }
        function getFanChatAvailability() {
            const settings=getFanChatSettings();
            if(settings.enabled===false) return {open:false,reason:'disabled'};
            if(settings.mode==='event_window') {
                const start=Date.parse(settings.start||''), end=Date.parse(settings.end||''), now=Date.now();
                if(!Number.isFinite(start)||!Number.isFinite(end)||start>=end||now<start||now>end) return {open:false,reason:'outside-window'};
            }
            return {open:true,reason:'open'};
        }
        function getFanChatOfflineMessage() {
            const settings=getFanChatSettings();
            const messages=Array.isArray(settings.offlineMessages)?settings.offlineMessages.map(s=>String(s||'').trim()).filter(Boolean):[];
            const defaults=['The fan chat is resting between events. Check back when the action begins.','The chat is taking a short break. Keep an eye on the event schedule.','The arena is quiet for now. Come back when the next event window opens.'];
            const options=messages.length?messages:defaults;
            return options[Math.floor(Math.random()*options.length)];
        }
        function applyFanChatAvailability() {
            const availability=getFanChatAvailability();
            const input=document.getElementById('chat-input-text'),sendButton=document.getElementById('chat-send-button'),status=document.getElementById('online-count'),feed=document.getElementById('chat-feed'),prompt=document.getElementById('chat-auth-prompt');
            if(!availability.open) {
                if(input){input.disabled=true;input.placeholder='Fan chat is currently offline';}
                if(sendButton)sendButton.disabled=true;
                document.querySelectorAll('.chat-reaction').forEach(button=>{button.disabled=true;button.classList.remove('text-white','hover:bg-gray-700');button.classList.add('text-gray-500');});
                if(status)status.innerText='● Chat offline';
                if(prompt){prompt.classList.remove('hidden');prompt.textContent=getFanChatOfflineMessage();}
                if(feed)feed.innerHTML='<div class="text-center text-gray-500 text-[10px] uppercase tracking-widest">'+escapeHtml(getFanChatOfflineMessage())+'</div>';
            }
            return availability.open;
        }

        async function handleSendChatMessage(e) {
            e.preventDefault(); if(!applyFanChatAvailability()) return; const input=document.getElementById('chat-input-text'); const val=input.value.trim();
            if(!val) return;
            try {
                if(!window.supabaseReady) throw new Error('Live chat is temporarily unavailable. Please try again later.');
                if(val.length>500) throw new Error('Messages must be 500 characters or fewer.');
                const {data:{user},error:authError}=await window.sb.auth.getUser();
                if(authError) throw authError;
                if(!user) throw new Error('Sign in before sending a chat message.');
                const {error}=await window.sb.from('chat_messages').insert({user_id:user.id,sender_name:user.user_metadata?.full_name||'Fan',sender_email:user.email||'',message:val,is_admin_reply:false,channel:'fan_chat'});
                if(error) throw error; input.value='';
            } catch(err) { showNotification('Could not send your chat message. Please try again later.','error'); }
        }
        function sendQuickReaction(text) { const input=document.getElementById('chat-input-text'); input.value=text; input.focus(); }
        function appendChatMessage(user, message, colorClass) {
            const chatFeed=document.getElementById('chat-feed'); if(!chatFeed) return;
            const msgEl=document.createElement('div'); msgEl.className='bg-gray-900/90 p-2.5 rounded-lg border border-gray-800 animate-fadeIn';
            msgEl.innerHTML=`<span class="${colorClass}">${escapeHtml(String(user))}:</span> <span class="text-gray-300 ml-1">${escapeHtml(String(message))}</span>`;
            chatFeed.appendChild(msgEl); while(chatFeed.children.length>80) chatFeed.removeChild(chatFeed.children[0]); chatFeed.scrollTop=chatFeed.scrollHeight;
        }
        async function clearChatFeed() {
            if(!window.__snrgAdminUser) { showNotification('Only an administrator can clear chat history.','error'); return; }
            if(!confirm('Delete all live chat messages?')) return;
            const {error}=await window.sb.from('chat_messages').delete().eq('channel','fan_chat');
            if(error) showNotification('Could not clear chat: '+error.message,'error');
            else { const feed=document.getElementById('chat-feed'); if(feed) feed.innerHTML='<div class="text-center text-gray-500 text-[10px] uppercase tracking-widest">— CHAT CLEARED —</div>'; await loadAdminChat(); }
        }
        function escapeHtml(text) {
            const map={'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'};
            return String(text).replace(/[&<>"']/g,function(m){return map[m];});
        }
        function startSimulatedChat() {
            const feed=document.getElementById('chat-feed');
            const status=document.getElementById('online-count');
            if(!window.supabaseReady) {
                if(feed) feed.innerHTML='<div class="text-center text-gray-500 text-[10px] uppercase tracking-widest">Live chat is temporarily unavailable.</div>';
                if(status) status.innerText='Chat unavailable';
                return;
            }
            window.sb.auth.getSession().then(({data,error})=>{
                if(error) { showNotification('Could not check your sign-in status: '+error.message,'error'); return; }
                updateLiveChatAuth(data.session);
            });
        }

        function showNotification(text, type = "info") {
            const toast = document.createElement('div');
            const bg = type === 'success' ? 'bg-green-600' : type === 'error' ? 'bg-red-600' : 'bg-brand-red';
            toast.className = `fixed bottom-5 right-5 z-50 ${bg} text-white px-5 py-3 rounded-xl shadow-2xl font-heading font-black text-xs uppercase tracking-wider transition-all transform flex items-center gap-2`;
            const icon = document.createElement('i');
            icon.className = 'fa-solid fa-circle-info';
            const message = document.createElement('span');
            message.textContent = String(text);
            toast.append(icon, message);
            document.body.appendChild(toast);

            setTimeout(() => {
                toast.classList.add('opacity-0', 'translate-y-2');
                setTimeout(() => toast.remove(), 300);
            }, 3500);
        }

        // Supabase content bridge: public visitors can read; only admin_users members can publish.
        async function loadSiteContentFromSupabase() {
            if (!window.supabaseReady) return;
            const { data, error } = await window.sb.from('site_content').select('content_value').eq('content_key', 'public').maybeSingle();
            if (error) console.warn('Supabase content read failed; using bundled defaults.', error);
            if (data?.content_value) applySiteContent(data.content_value);
            // Keep the public roster, event schedule, and product list connected to their structured tables.
            try {
                const structuredResults = await Promise.allSettled([
                    window.sb.from('fighters').select('id,name,nickname,record,bio,image_url,is_published').eq('is_published', true).order('created_at', {ascending:false}),
                    window.sb.from('events').select('id,title,event_date,venue,main_event,description,flyer_image_url,status,is_published').eq('is_published', true).in('status', ['upcoming','live','completed']).order('event_date', {ascending:true}),
                    window.sb.from('training_schedule').select('id,title,discipline,day_of_week,start_time,end_time,coach,location,notes,is_published').eq('is_published', true).order('day_of_week').order('start_time'),
                    window.sb.from('products').select('id,name,description,image_url,price_cents,currency,product_url,is_published').eq('is_published', true).order('created_at', {ascending:false}),
                    window.sb.functions.invoke('list-available-streams'),
                    window.sb.from('public_media_catalog').select('id,title,category,description,file_url,price,price_confirmed,is_published,collection,media_destination,event_id,created_at,preview_path').eq('is_published', true).order('created_at', {ascending:false})
                ]);
                // A stream-function/network failure must not prevent unrelated content, especially videos, from rendering.
                const settledValue = (result, label) => {
                    if (result.status === 'rejected') {
                        console.warn(label + ' request failed.', result.reason);
                        return { data: null, error: result.reason };
                    }
                    return result.value;
                };
                const [fightersResult, eventsResult, scheduleResult, productsResult, streamsResult, mediaResult] =
                    structuredResults.map((result, index) => settledValue(result, ['fighters','events','schedule','products','live streams','media'][index]));
                if (fightersResult.error) console.warn('Could not load published fighters from Supabase.', fightersResult.error);
                else siteData.fighters = (fightersResult.data || []).map(f => ({id:f.id,name:f.name,record:f.record||'',desc:f.bio||f.nickname||'',initials:(f.name||'').substring(0,2).toUpperCase(),image:f.image_url||''}));
                if (eventsResult.error) console.warn('Could not load events from Supabase.', eventsResult.error);
                if (streamsResult.error) console.warn('Could not load available live streams from Supabase.', streamsResult.error);
                const availableStreams = streamsResult.data?.streams || [];
                if (scheduleResult.error) console.warn('Could not load training schedule from Supabase.', scheduleResult.error);
                const savedEvents = new Map(siteData.schedule.map(item => [String(item.id), item]));
                const fightQuestEvent=(eventsResult.data||[]).find(e=>String(e.title||'').toLowerCase().includes('fight quest xvi'));
                const flyerImage=document.getElementById('fightQuestFlyerImage'),flyerDocument=document.getElementById('fightQuestFlyerDocument');
                if(flyerImage&&flyerDocument){
                    const flyerUrl=getSafeHttpUrl(fightQuestEvent?.flyer_image_url||'');
                    flyerImage.onerror=null;
                    flyerImage.onload=null;
                    flyerDocument.textContent='Open or download the official event flyer';
                    if(flyerUrl){
                        const path=flyerUrl.split('?')[0].toLowerCase();
                        if(/\.(?:pdf|doc|docx)$/i.test(path)){flyerImage.removeAttribute('src');flyerImage.classList.add('hidden');flyerDocument.href=flyerUrl;flyerDocument.classList.remove('hidden');}
                        else{
                            flyerDocument.href=flyerUrl;
                            flyerImage.onerror=()=>{
                                flyerImage.removeAttribute('src');
                                flyerImage.classList.add('hidden');
                                flyerDocument.textContent='Flyer image could not be displayed. Open or download the official event flyer';
                                flyerDocument.classList.remove('hidden');
                            };
                            flyerImage.onload=()=>{flyerDocument.textContent='Open or download the official event flyer';flyerDocument.classList.add('hidden');};
                            flyerImage.src=flyerUrl;
                            flyerImage.classList.remove('hidden');
                            flyerDocument.classList.add('hidden');
                        }
                    }else{flyerImage.removeAttribute('src');flyerImage.classList.add('hidden');flyerDocument.removeAttribute('href');flyerDocument.classList.add('hidden');}
                }
                const eventItems = (eventsResult.data || []).map(e => {
                    const canSellStream = ['upcoming', 'live'].includes(e.status);
                    const stream = canSellStream ? availableStreams.find(item => item.event_id === e.id) : null;
                    const streamPrice = stream ? new Intl.NumberFormat('en-US',{style:'currency',currency:stream.currency||'USD'}).format((stream.price_cents||0)/100) : '';
                    return {id:e.id,type:'event',date:e.event_date?formatLongDate(e.event_date):'Date to be announced',eventDate:e.event_date||'',status:e.status,title:e.title,flyerImage:getSafeHttpUrl(e.flyer_image_url||''),subtitle:[e.venue,e.main_event,e.description].filter(Boolean).join(' • '),ticketPrice:stream?'Live stream: '+streamPrice+' · LIVE EVENT ONLY · NO REPLAY':(canSellStream?'Live-stream access not available yet':'Sales closed'),streamEnabled:!!stream,inPersonTicketUrl:e.id==='9499bd8b-3d1c-4b9d-8801-07447c3c94b9'?'https://buytickets.at/fitnessquest/2470795':'',inPersonTicketPricing:e.id==='9499bd8b-3d1c-4b9d-8801-07447c3c94b9'?'General Admission $45 · VIP Ringside $85':'',link:savedEvents.get(String(e.id))?.link || ''};
                });
                const classItems = (scheduleResult.data||[]).map(s => ({id:s.id,type:'class',date:['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][s.day_of_week]+' '+String(s.start_time||'').slice(0,5),title:s.title,subtitle:[s.discipline,s.coach,s.location,s.notes].filter(Boolean).join(' • '),link:''}));
                if (!eventsResult.error) siteData.schedule = [...eventItems, ...(scheduleResult.error ? [] : classItems)];
                else if (!scheduleResult.error) siteData.schedule = [...siteData.schedule.filter(item => item.type === 'event'), ...classItems];
                if (productsResult.error) console.warn('Could not load products from Supabase.', productsResult.error);
                else siteData.store = (productsResult.data || []).map(p => ({id:p.id,title:p.name,subtitle:p.description||'Official FQ MMA media',price:new Intl.NumberFormat('en-US',{style:'currency',currency:p.currency||'USD'}).format((p.price_cents||0)/100),link:p.product_url||'',image:p.image_url||''}));
                if (mediaResult.error) console.warn('Could not load published media from Supabase.', mediaResult.error);
                else {
                    const eventTitleMap = new Map((eventsResult.data || []).map(e => [e.id, e.title]));
                    const databaseMedia = (mediaResult.data || []).map(m => ({
                        id: 'media-' + m.id, mediaId: m.id, title: m.title, category: m.category || 'Photo',
                        collection: m.collection || 'mma_event', mediaDestination: m.media_destination || 'site', eventId: m.event_id || null, eventTitle: m.event_id ? (eventTitleMap.get(m.event_id) || '') : '',
                        priceAmount: Number(m.price || 0), priceConfirmed: m.price_confirmed === true, price: Number(m.price || 0) > 0 && m.price_confirmed === true ? new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(m.price)) : 'Price available on request',
                        image: (m.file_url && /\.(?:avif|gif|jpe?g|png|webp)(?:[?#].*)?$/i.test(String(m.file_url))) ? m.file_url : (m.preview_path ? (window.sb.storage.from('fqmma-media').getPublicUrl(m.preview_path).data?.publicUrl || '') : ''), previewPath: m.preview_path || '', livepeerPlaybackId: '', livepeerStatus: 'not_used', previewUrl: '', link: m.file_url || '',
                        protectedMedia: true, description: m.description || ''
                    }));
                    siteData.portfolio = [...databaseMedia, ...siteData.portfolio.filter(p => !p.mediaId)];
                }
            } catch (e) { console.warn('Supabase structured content could not be loaded; retaining homepage defaults.', e); }
            renderAllContent();
            // Do not override the visitor's selected/default tab after async content loads.
            // The DOMContentLoaded handler owns initial navigation; this function only refreshes content.
            if (window.__snrgAdminUser) renderAdminManagerLists();
        }

        const DEFAULT_DISCIPLINES = [{"id":1,"name":"Traditional Karate","desc":"A traditional Japanese martial art built around disciplined basics, strong stances, blocks, strikes, forms, and controlled partner practice.","link":"","imageUrl":""},{"id":2,"name":"Shotokan","desc":"A style of karate known for deep stances, precise linear techniques, powerful basics, kata, timing, and distance control.","link":"","imageUrl":""},{"id":3,"name":"Kickboxing","desc":"A stand-up combat sport combining punches and kicks, with training in combinations, footwork, defense, conditioning, and controlled sparring.","link":"","imageUrl":""},{"id":4,"name":"Muay Thai","desc":"Thailand’s striking art using punches, kicks, knees, elbows, and clinch work, developed through technique, balance, conditioning, and pad drills.","link":"","imageUrl":""},{"id":5,"name":"Boxing","desc":"A striking sport focused on punches, footwork, head movement, defense, timing, combinations, and ring awareness.","link":"","imageUrl":""},{"id":6,"name":"Kids Boxing","desc":"Age-appropriate boxing fundamentals emphasizing coordination, balance, fitness, focus, confidence, safe technique, and non-contact drills.","link":"","imageUrl":""},{"id":7,"name":"Judo","desc":"A Japanese grappling art and Olympic sport focused on throws, trips, pins, balance-breaking, safe falling, and controlled groundwork.","link":"","imageUrl":""},{"id":8,"name":"Jiu Jitsu","desc":"A grappling art focused on positional control, escapes, transitions, takedowns, and submission techniques practiced with control and respect.","link":"","imageUrl":""},{"id":9,"name":"Wrestling","desc":"A grappling sport that develops takedowns, control, balance, pressure, escapes, conditioning, and the ability to defend or improve position.","link":"","imageUrl":""},{"id":10,"name":"Kids Kickboxing","desc":"A kid-friendly introduction to punches, kicks, movement, balance, and fitness using structured drills that build focus, confidence, and respect.","link":"","imageUrl":""}];
        function disciplineAliasKey(name) {
            const n = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
            if (n.includes('kickboxing') && !n.includes('kids')) return 'kickboxing';
            if (n.includes('brazilianjiujitsu') || n === 'jiujitsu' || n === 'bjj') return 'jiujitsu';
            if (n === 'boxing') return 'boxing';
            return n;
        }
        function mergeDefaultDisciplines(content) {
            const saved = Array.isArray(content.disciplines) ? content.disciplines : [];
            const oldVersion = Number(content.disciplineDefaultsVersion || 0);
            const merged = saved.map(item => {
                const def = DEFAULT_DISCIPLINES.find(d => disciplineAliasKey(d.name) === disciplineAliasKey(item.name));
                if (!def) return item;
                return oldVersion < 2
                    ? { ...def, ...item, id: item.id ?? def.id, name: def.name, desc: def.desc, link: item.link || '', imageUrl: item.imageUrl || item.image || def.imageUrl }
                    : { ...def, ...item, id: item.id ?? def.id, imageUrl: item.imageUrl || item.image || def.imageUrl };
            });
            // Preserve an explicitly empty published list so the public page can show its empty state.
            // For non-empty legacy lists, continue filling missing standard disciplines for compatibility.
            if (saved.length > 0) {
                for (const def of DEFAULT_DISCIPLINES) {
                    if (!merged.some(item => disciplineAliasKey(item.name) === disciplineAliasKey(def.name))) merged.push({ ...def });
                }
            }
            // Saved public settings may contain duplicate IDs. Admin edit/delete actions
            // use IDs as identity, so make every ID unique before rendering those controls.
            const seenIds = new Set();
            content.disciplines = merged.map((item, index) => {
                let normalized = item && typeof item === 'object' ? { ...item } : { name: String(item || '') };
                let key = String(normalized.id ?? '').trim();
                if (!key || seenIds.has(key)) {
                    let nextId = Date.now() + index;
                    while (seenIds.has(String(nextId))) nextId += 1;
                    normalized.id = nextId;
                    key = String(nextId);
                }
                seenIds.add(key);
                return normalized;
            });
            content.disciplineDefaultsVersion = 2;
            return content;
        }

        function renderSectionContactDirectory(content) {
            const host=document.getElementById('section-contact-directory');
            if(!host)return;
            const contacts=content?.general?.sectionContacts;
            if(!contacts||typeof contacts!=='object'){host.innerHTML='';return;}
            const labels={general:'General & Support',events:'Events',training:'Training',portfolio:'Photography & Portfolio',bookings:'Bookings',livestream:'Livestream & Tickets'};
            host.innerHTML=Object.entries(labels).map(([key,label])=>{
                const row=contacts[key]&&typeof contacts[key]==='object'?contacts[key]:{};
                const email=String(row.email||'').trim(),phone=String(row.phone||'').trim();
                if(!email&&!phone)return '';
                return '<div class="rounded-lg border border-gray-800 bg-black/20 p-3"><h3 class="font-bold text-sm">'+escapeHtml(label)+'</h3>'+(email?'<p class="text-sm mt-1 break-all">Email: <a class="underline text-red-300" href="mailto:'+escapeHtml(email)+'">'+escapeHtml(email)+'</a></p>':'')+(phone?'<p class="text-sm mt-1">Phone: <a class="underline text-red-300" href="tel:'+escapeHtml(phone)+'">'+escapeHtml(phone)+'</a></p>':'')+'</div>';
            }).join('');
        }

        function applyTicketAppearance(content) {
            const settings=content?.general?.ticketAppearance||{};
            const valid=value=>typeof value==='string'&&/^#[0-9a-f]{6}$/i.test(value);
            const card=document.querySelector('#schedule-container article');
            if(card){
                if(valid(settings.cardBackground))card.style.backgroundColor=settings.cardBackground;
                if(valid(settings.cardBorder))card.style.borderColor=settings.cardBorder;
                const accent=card.querySelector('.font-bold.text-brand-neon');
                if(accent&&valid(settings.accent))accent.style.color=settings.accent;
                const button=card.querySelector('#inPersonTicketLink');
                if(button){
                    if(valid(settings.buttonBackground))button.style.backgroundColor=settings.buttonBackground;
                    if(valid(settings.buttonText))button.style.color=settings.buttonText;
                    if(typeof settings.buttonLabel==='string'&&settings.buttonLabel.trim())button.textContent=settings.buttonLabel.trim().slice(0,120);
                }
            }
        }

        function applySiteContent(value) {
            let content;
            try { content = JSON.parse(value); }
            catch (error) { console.error('Saved website content is not valid JSON.', error); return false; }
            const requiredArrays = ['disciplines', 'schedule', 'fighters', 'store', 'portfolio', 'promos'];
            if (!content || typeof content !== 'object' || !content.general || typeof content.general !== 'object' ||
                requiredArrays.some(key => !Array.isArray(content[key]))) {
                console.error('Saved website content has an invalid structure.');
                return false;
            }
            mergeDefaultDisciplines(content);
            Object.keys(window.siteData).forEach(key => delete window.siteData[key]);
            Object.assign(window.siteData, content);
            renderSectionContactDirectory(window.siteData);
            applyTicketAppearance(window.siteData);
            if (typeof window.siteData.general.paysiteUrl === 'string') PAYSITE_URL = window.siteData.general.paysiteUrl;
            return true;
        }

        (function initSupabaseContentBridge(){
            let applyingRemote = false;
            const originalRender = window.renderAllContent || renderAllContent;
            window.renderAllContent = function(){
                const result = originalRender.apply(this, arguments);
                applyTicketAppearance(window.siteData);
                if (!applyingRemote && window.__snrgAdminUser && window.supabaseReady) {
                    window.sb.from('site_content').upsert({ content_key: 'public', content_value: JSON.stringify(window.siteData), updated_by: window.__snrgAdminUser.id, updated_at: new Date().toISOString() })
                      .then(({error}) => { if (error) showNotification('Could not save website changes: ' + error.message, 'error'); });
                }
                return result;
            };
            if (!window.supabaseReady) return;
            // Load both the homepage JSON and the structured public tables from the same startup path.
            applyingRemote = true;
            loadSiteContentFromSupabase()
              .catch(error => {
                console.warn('Supabase content unavailable; using bundled defaults.', error);
                originalRender.call(window);
              })
              .finally(() => { applyingRemote = false; });
            window.sb.auth.onAuthStateChange(async (event, session) => {
                if (!session?.user) { window.__snrgAdminUser = null; isAdminLoggedIn = false; return; }
                try {
                    // Avoid opening admin automatically for ordinary member sessions.
                    if (new URLSearchParams(location.search).get('admin') === '1') {
                        await activateAdminSession(session.user);
                    }
                } catch (e) { const box=document.getElementById('admin-login-error'); if(box) box.textContent=e.message; }
            });
        })();

        function openMediaCheckout(mediaId, title) {
            document.getElementById('mediaPurchaseId').value=String(mediaId);
            document.getElementById('mediaPurchaseTitle').textContent=title||'Purchase media';
            document.getElementById('mediaPurchaseMessage').textContent='';
            document.getElementById('mediaPurchaseForm').classList.remove('hidden');
            document.getElementById('mediaDeliveryForm').classList.add('hidden');
            document.getElementById('mediaPurchaseModal').classList.remove('hidden');
            document.getElementById('mediaPurchaseEmail').focus();
        }
        document.addEventListener('click',event=>{
            const pricingButton=event.target.closest('[data-contact-pricing]');
            if(pricingButton) {
                const contactTabButton=document.querySelector('[data-tab="contact"]');
                if(typeof window.setActiveTab === 'function') window.setActiveTab('contact');
                else contactTabButton?.click();
                const category=document.getElementById('contact-category');
                const message=document.getElementById('contact-message');
                const title=pricingButton.dataset.mediaTitle || 'digital media';
                const collection=pricingButton.dataset.mediaCollection || 'media';
                if(category) category.value=collection === 'photography' ? 'Portfolio / Photography Inquiry' : 'Media Purchase Inquiry';
                if(message) {
                    message.value=`Hello, I would like pricing and purchase details for "${title}" (${collection}). Please let me know the available options.\n\n`;
                    message.focus();
                }
                document.getElementById('tab-contact')?.scrollIntoView({behavior:'smooth',block:'start'});
                return;
            }
            const button=event.target.closest('[data-buy-media]');
            if(button) openMediaCheckout(button.dataset.buyMedia,button.dataset.mediaTitle);
        });
        document.getElementById('mediaPurchaseClose')?.addEventListener('click',()=>document.getElementById('mediaPurchaseModal').classList.add('hidden'));
        document.getElementById('mediaPurchaseModal')?.addEventListener('click',event=>{if(event.target.id==='mediaPurchaseModal') event.currentTarget.classList.add('hidden');});
        document.getElementById('mediaPurchaseForm')?.addEventListener('submit',async event=>{
            event.preventDefault();
            const button=document.getElementById('mediaPurchaseSubmit'), message=document.getElementById('mediaPurchaseMessage');
            button.disabled=true; button.textContent='Preparing secure checkout…'; message.textContent='';
            try {
                await window.ensureSupabaseClient();
                if(!window.supabaseReady||!window.sb) throw new Error('Secure checkout is temporarily unavailable.');
                const {data,error}=await window.sb.functions.invoke('create-media-checkout',{body:{media_id:Number(document.getElementById('mediaPurchaseId').value),buyer_email:document.getElementById('mediaPurchaseEmail').value.trim(),accepted_terms:document.getElementById('mediaPurchaseTermsAccepted').checked}});
                if(error) throw error;
                if(!data?.url||!data.url.startsWith('https://checkout.stripe.com/')) throw new Error(data?.error||'Could not open secure checkout.');
                window.location.assign(data.url);
            } catch(err){message.textContent=await getFunctionErrorMessage(err,'Checkout failed. No payment was taken.');}
            finally{button.disabled=false;button.textContent='Continue to secure payment';}
        });
        document.getElementById('mediaDeliveryForm')?.addEventListener('submit',async event=>{
            event.preventDefault();
            const button=document.getElementById('mediaDeliverySubmit'),message=document.getElementById('mediaDeliveryMessage');
            button.disabled=true;button.textContent='Verifying purchase…';message.textContent='';
            try {
                await window.ensureSupabaseClient();
                const {data,error}=await window.sb.functions.invoke('create-protected-media-url',{body:{media_id:Number(document.getElementById('mediaDeliveryId').value),buyer_email:document.getElementById('mediaDeliveryEmail').value.trim(),session_id:document.getElementById('mediaDeliverySessionId').value}});
                if(error) throw error;
                if(!data?.url||!data.url.startsWith('https://')) throw new Error(data?.error||'Download link could not be created.');
                message.innerHTML='';
                const link=document.createElement('a');link.href=data.url;link.textContent='Download '+(data.title||'your media');link.target='_blank';link.rel='noopener noreferrer';link.className='inline-flex rounded-lg bg-brand-red px-4 py-2 text-xs font-black uppercase text-white';message.appendChild(link);
                message.insertAdjacentText('beforeend',' This private link expires in 15 minutes.');
            } catch(err){message.textContent=await getFunctionErrorMessage(err,'Could not verify purchase yet.');}
            finally{button.disabled=false;button.textContent='Get my download';}
        });
        const mediaPurchaseResult=new URLSearchParams(window.location.search);
        if(mediaPurchaseResult.get('media_purchase')==='success'&&mediaPurchaseResult.get('media_id')){
            document.addEventListener('DOMContentLoaded',()=>{
                document.getElementById('mediaPurchaseModal').classList.remove('hidden');
                document.getElementById('mediaPurchaseForm').classList.add('hidden');
                document.getElementById('mediaDeliveryForm').classList.remove('hidden');
                document.getElementById('mediaDeliveryId').value=mediaPurchaseResult.get('media_id');
                document.getElementById('mediaDeliverySessionId').value=mediaPurchaseResult.get('session_id')||'';
                document.getElementById('mediaPurchaseTitle').textContent='Get your download';
                document.getElementById('mediaDeliveryMessage').textContent='Your payment is being verified. If it just completed, wait a few seconds and try again.';
            });
        } else if(mediaPurchaseResult.get('media_purchase')==='cancelled'){
            document.addEventListener('DOMContentLoaded',()=>{
                document.getElementById('mediaPurchaseModal').classList.remove('hidden');
                document.getElementById('mediaPurchaseTitle').textContent='Checkout cancelled';
                document.getElementById('mediaPurchaseMessage').textContent='No payment was completed. You can close this window or try again.';
            });
        }
        async function uploadSiteMedia(e) {
            e.preventDefault();
            const status = document.getElementById('media-upload-status');
            status.textContent = 'This legacy uploader is disabled. Use admin.html → MMA Media & Sasha’s Portfolio to upload private originals. Uploaded videos are not played publicly.';
            showNotification('Use the protected media uploader in admin.html.', 'info');
        }

        async function loadAdminTicketPurchases() {
            const box=document.getElementById('admin-ticket-purchases-list');
            box.innerHTML='<p class="text-xs text-gray-400">Loading ticket purchases…</p>';
            try {
                const [purchases, options, events] = await Promise.all([
                    window.sb.from('ticket_purchases').select('id,buyer_email,quantity,total_cents,currency,status,created_at,ticket_option_id,event_id,stripe_checkout_session_id').order('created_at',{ascending:false}).limit(100),
                    window.sb.from('event_ticket_options').select('id,name'),
                    window.sb.from('events').select('id,title')
                ]);
                if(purchases.error) throw purchases.error;
                const optionMap=new Map((options.data||[]).map(x=>[x.id,x.name]));
                const eventMap=new Map((events.data||[]).map(x=>[x.id,x.title]));
                if(!purchases.data?.length){box.innerHTML='<p class="text-xs text-gray-400">No ticket purchases yet.</p>';return;}
                box.innerHTML=purchases.data.map(p=>`<div class="rounded border border-gray-800 bg-black p-3"><div class="flex flex-wrap items-center justify-between gap-2"><div class="text-xs font-bold">${escapeHtml(eventMap.get(p.event_id)||'Event')} · ${escapeHtml(optionMap.get(p.ticket_option_id)||'Ticket')}</div><span class="text-[10px] uppercase ${p.status==='paid'?'text-emerald-400':p.status==='refunded'?'text-yellow-300':'text-gray-400'}">${escapeHtml(p.status)}</span></div><div class="mt-2 text-xs">${escapeHtml(p.buyer_email)} · ${p.quantity} ticket(s) · ${escapeHtml(new Intl.NumberFormat('en-US',{style:'currency',currency:p.currency||'USD'}).format((p.total_cents||0)/100))}</div><div class="mt-1 break-all text-[10px] text-gray-500">${escapeHtml(p.stripe_checkout_session_id||'Checkout not completed')} · ${formatLongDateTime(p.created_at)}</div></div>`).join('');
            } catch(err) { box.innerHTML=`<p class="text-xs text-red-400">${escapeHtml(err.message)}. Confirm the ticket-sales migration is applied.</p>`; }
        }

        async function loadAdminChat() {
            const box=document.getElementById('admin-chat-list'); box.innerHTML='<p class="text-xs text-gray-400">Loading chat…</p>';
            try { const {data,error}=await window.sb.from('chat_messages').select('id,sender_name,message,created_at').order('created_at',{ascending:false}).limit(100); if(error) throw error;
              if(!data?.length){box.innerHTML='<p class="text-xs text-gray-400">No messages yet.</p>';return;}
              box.innerHTML=data.map(m=>`<div class="flex items-start justify-between gap-3 rounded border border-gray-800 bg-black p-3"><div><div class="text-[10px] text-gray-500">${escapeHtml(m.sender_name||'Fan')} • ${formatLongDateTime(m.created_at)}</div><div class="mt-1 text-xs">${escapeHtml(m.message)}</div></div><button onclick="deleteChatMessage('${m.id}')" class="text-xs text-red-400">Delete</button></div>`).join('');
            } catch(err) { box.textContent='Chat moderation is temporarily unavailable. Refresh the dashboard or contact the site owner.'; }
        }
        async function deleteChatMessage(id) { const {error}=await window.sb.from('chat_messages').delete().eq('id',id); if(error) showNotification(error.message,'error'); else await loadAdminChat(); }

        async function loadLiveChat() {
            if (!applyFanChatAvailability()) return;
            if (!window.supabaseReady) return;
            const {data,error}=await window.sb.from('chat_messages').select('sender_name,message,created_at').eq('channel','fan_chat').order('created_at',{ascending:true}).limit(60);
            const feed=document.getElementById('chat-feed'); if(!feed) return;
            if(error) {
                feed.innerHTML='<div class="text-center text-red-400 text-[10px]">Live chat is temporarily unavailable. Please try again later.</div>';
                console.error('Live chat could not load.',error);
                return;
            }
            feed.innerHTML=''; (data||[]).forEach(m=>appendChatMessage(m.sender_name||'Fan',m.message,'text-brand-neon font-black font-heading'));
        }
        let liveChatSubscription=null;
        let liveChatUserId=null;
        function subscribeLiveChat() {
            if(!getFanChatAvailability().open || !window.supabaseReady || liveChatSubscription) return;
            liveChatSubscription=window.sb.channel('signed-in-fan-chat').on('postgres_changes',{event:'INSERT',schema:'public',table:'chat_messages',filter:'channel=eq.fan_chat'},payload=>{
                const m=payload.new; appendChatMessage(m.sender_name||'Fan',m.message,'text-brand-neon font-black font-heading');
            }).subscribe((status)=>{
                const statusEl=document.getElementById('online-count');
                if(statusEl) statusEl.innerText=status==='SUBSCRIBED'?'● Chat connected':status==='CHANNEL_ERROR'||status==='TIMED_OUT'?'Chat reconnecting…':'Connecting…';
            });
        }
        async function updateLiveChatAuth(session) {
            if(!applyFanChatAvailability()) { if(liveChatSubscription){await window.sb.removeChannel(liveChatSubscription);liveChatSubscription=null;} liveChatUserId=null; return; }
            const input=document.getElementById('chat-input-text');
            const sendButton=document.getElementById('chat-send-button');
            const authPrompt=document.getElementById('chat-auth-prompt');
            const status=document.getElementById('online-count');
            const feed=document.getElementById('chat-feed');
            const user=session?.user;
            if(!user) {
                if(liveChatSubscription) { await window.sb.removeChannel(liveChatSubscription); liveChatSubscription=null; }
                liveChatUserId=null;
                input.disabled=true; sendButton.disabled=true;
                document.querySelectorAll('.chat-reaction').forEach(button=>{button.disabled=true;button.classList.remove('text-white','hover:bg-gray-700');button.classList.add('text-gray-500');});
                authPrompt.classList.remove('hidden');
                input.placeholder='Sign in to join the chat';
                status.innerText=window.supabaseReady?'Sign in to chat':'Chat unavailable';
                feed.innerHTML='<div class="text-center text-gray-500 text-[10px] uppercase tracking-widest">Sign in to join the fan chat.</div>';
                return;
            }
            if(liveChatUserId===user.id) return;
            if(liveChatSubscription) { await window.sb.removeChannel(liveChatSubscription); liveChatSubscription=null; }
            liveChatUserId=user.id;
            input.disabled=false; sendButton.disabled=false;
            document.querySelectorAll('.chat-reaction').forEach(button=>{button.disabled=false;button.classList.remove('text-gray-500');button.classList.add('text-white','hover:bg-gray-700');});
            authPrompt.classList.add('hidden');
            input.placeholder='Write a message (500 characters max)';
            status.innerText='Loading chat…';
            await loadLiveChat();
            subscribeLiveChat();
        }

        setInterval(async()=>{if(!window.supabaseReady)return;try{const {data}=await window.sb.auth.getSession();await updateLiveChatAuth(data?.session||null);}catch(_error){}},30000);

        function setupAccessibleDialogs() {
            const dialogs = Array.from(document.querySelectorAll('[role="dialog"][aria-modal="true"]'));
            if (!dialogs.length) return;
            const focusableSelector = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
            let recentTrigger = null;
            let recentTriggerAt = 0;

            document.addEventListener('click', event => {
                const target = event.target instanceof Element ? event.target.closest('button,a,[role="button"]') : null;
                if (target && !target.closest('[role="dialog"]')) {
                    recentTrigger = target;
                    recentTriggerAt = Date.now();
                }
            }, true);

            const syncDialog = dialog => {
                const open = !dialog.classList.contains('hidden') && !dialog.hasAttribute('hidden');
                const wasOpen = dialog.dataset.accessibleOpen === 'true';
                dialog.setAttribute('aria-hidden', open ? 'false' : 'true');
                dialog.dataset.accessibleOpen = String(open);
                if (open && !wasOpen) {
                    dialog._returnFocus = recentTrigger && Date.now() - recentTriggerAt < 1500 ? recentTrigger : null;
                    recentTrigger = null;
                    recentTriggerAt = 0;
                    if (!dialog.contains(document.activeElement)) {
                        const items = Array.from(dialog.querySelectorAll(focusableSelector)).filter(el => el.getClientRects().length > 0 && !el.closest('[hidden]'));
                        if (items[0]) items[0].focus({ preventScroll: true });
                        else { dialog.setAttribute('tabindex', '-1'); dialog.focus({ preventScroll: true }); }
                    }
                } else if (!open && wasOpen) {
                    if (dialog._returnFocus && dialog._returnFocus.isConnected) dialog._returnFocus.focus({ preventScroll: true });
                    dialog._returnFocus = null;
                }
            };

            dialogs.forEach(dialog => {
                dialog.setAttribute('aria-hidden', dialog.classList.contains('hidden') || dialog.hasAttribute('hidden') ? 'true' : 'false');
                dialog.dataset.accessibleOpen = String(!dialog.classList.contains('hidden') && !dialog.hasAttribute('hidden'));
            });
            const observer = new MutationObserver(records => {
                Array.from(new Set(records.map(record => record.target))).forEach(syncDialog);
            });
            dialogs.forEach(dialog => observer.observe(dialog, { attributes: true, attributeFilter: ['class', 'hidden'] }));

            document.addEventListener('keydown', event => {
                const dialog = dialogs.slice().reverse().find(item => item.dataset.accessibleOpen === 'true');
                if (!dialog) return;
                if (event.key === 'Escape') {
                    event.preventDefault();
                    const closeButton = dialog.querySelector('[data-dialog-close],button[aria-label*="close" i],button[id$="Close"],button[id$="close"]');
                    if (closeButton) closeButton.click();
                    else dialog.classList.add('hidden');
                    return;
                }
                if (event.key !== 'Tab') return;
                const items = Array.from(dialog.querySelectorAll(focusableSelector)).filter(el => el.getClientRects().length > 0 && !el.closest('[hidden]'));
                if (!items.length) { event.preventDefault(); dialog.focus(); return; }
                const first = items[0];
                const last = items[items.length - 1];
                if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
                    event.preventDefault(); last.focus();
                } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
                    event.preventDefault(); first.focus();
                }
            });
        }

        window.addEventListener('DOMContentLoaded', async () => {
            setupAccessibleDialogs();
            ensurePublicNavigation();
            // Select the requested tab immediately, before any network/Supabase waits, so
            // the static HTML's initial panel cannot flash and then jump to another section.
            const requestedTabAtStart = tabFromHash(window.location.hash);
            setActiveTab(requestedTabAtStart || 'live', true);

            // Always load structured public content after the Supabase client finishes initializing.
            // The content bridge may run before Supabase is ready and skip its initial load.
            const publicLoadPromise = (async () => {
                await window.ensureSupabaseClient().catch(() => null);
                if (window.supabaseReady && window.sb) {
                    try {
                        await loadSiteContentFromSupabase();
                    } catch (error) {
                        console.warn('Supabase public content load failed after client initialization.', error);
                    }
                }
            })();
            let publicLoadTimeout;
            const publicLoadStatus = await Promise.race([
                publicLoadPromise.then(() => 'complete', error => {
                    console.warn('Public content initialization failed; rendering available fallback content.', error);
                    return 'failed';
                }),
                new Promise(resolve => {
                    publicLoadTimeout = window.setTimeout(() => resolve('timeout'), 10000);
                })
            ]);
            window.clearTimeout(publicLoadTimeout);
            if (publicLoadStatus === 'timeout') {
                console.warn('Public content initialization exceeded 10 seconds; rendering available fallback content.');
                publicLoadPromise.then(() => {
                    window.renderAllContent();
                    cleanupExpiredPromos();
                    syncPublicTabs();
                }).catch(error => console.warn('Late public content load failed.', error));
            }
            try {
                window.renderAllContent();
            } catch (error) {
                console.error('Public content rendering failed; preserving loading fallbacks where possible.', error);
                document.querySelectorAll('#disciplines-container, #schedule-container, #roster-container, #store-container, #mma-event-media-container, #sasha-portfolio-container').forEach(container => {
                    if (/^loading\b/i.test(container.textContent.trim())) {
                        container.innerHTML = '<p class="text-center text-sm text-gray-400">Content could not be loaded right now. Please refresh shortly.</p>';
                    }
                });
            }
            cleanupExpiredPromos();
            syncPublicTabs();
            window.addEventListener('hashchange', () => { const requested = tabFromHash(window.location.hash); if (requested) setActiveTab(requested, false); });
            const ticketResult = new URLSearchParams(window.location.search).get('ticket_purchase');
            if (ticketResult === 'success') showNotification('Checkout returned successfully. Keep your Stripe receipt; the team can verify ticket payment from the admin dashboard.', 'info');
            else if (ticketResult === 'cancelled') showNotification('Checkout was cancelled. No ticket payment was completed.', 'info');
            if (new URLSearchParams(location.search).get('admin') === '1') { window.location.replace(new URL('./admin.html', window.location.href).href); return; }
            if (window.supabaseReady) {
                window.sb.auth.getSession().then(async ({data}) => {
                    updateLiveChatAuth(data.session);
                    if (data?.session?.user && new URLSearchParams(location.search).get('admin') === '1') {
                        try { await activateAdminSession(data.session.user); } catch(err) { const box=document.getElementById('admin-login-error'); if(box) box.textContent=err.message; }
                    }
                });
                window.sb.auth.onAuthStateChange((_event,session)=>{ setTimeout(()=>updateLiveChatAuth(session),0); });
            }
            if(!window.supabaseReady) startSimulatedChat();
            // Keep one canonical admin dashboard instead of opening the retired embedded panel.
            window.addEventListener('keydown', (e) => {
                if (e.ctrlKey && e.shiftKey && e.key.toUpperCase() === 'A') {
                    e.preventDefault();
                    window.location.href = './admin.html';
                }
            });
        });
    