// Scroll Animation
const observerOptions = {
    threshold: 0.05,
    rootMargin: '0px 0px -50px 0px'
};

const observer = new IntersectionObserver(function(entries) {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.classList.add('visible');
        }
    });
}, observerOptions);

// Observe all fade-in elements
document.addEventListener('DOMContentLoaded', function() {
    document.querySelectorAll('.fade-in').forEach(el => {
        observer.observe(el);
    });

    // Stagger story cards
    document.querySelectorAll('.story-card').forEach((card, i) => {
        card.style.transitionDelay = `${i * 0.15}s`;
    });

    // Stagger feature cards
    document.querySelectorAll('.feature-card').forEach((card, i) => {
        card.style.transitionDelay = `${i * 0.2}s`;
    });
});

// Hamburger Menu
function toggleMenu() {
    const nav = document.getElementById('mainNav');
    const toggle = document.getElementById('menuToggle');
    nav.classList.toggle('active');
    toggle.classList.toggle('active');
}

function closeMenu() {
    const nav = document.getElementById('mainNav');
    const toggle = document.getElementById('menuToggle');
    nav.classList.remove('active');
    toggle.classList.remove('active');
}

// Mobile dropdown toggle
document.addEventListener('DOMContentLoaded', function() {
    const hasDropdown = document.querySelector('.has-dropdown > a');
    if (hasDropdown) {
        hasDropdown.addEventListener('click', function(e) {
            if (window.innerWidth <= 768) {
                e.preventDefault();
                e.stopPropagation();
                document.getElementById('storiesDropdown').classList.toggle('mobile-open');
            }
        });
    }
});

// Close menu on outside click
document.addEventListener('click', function(e) {
    const nav = document.getElementById('mainNav');
    const toggle = document.getElementById('menuToggle');
    if (nav && toggle) {
        if (!nav.contains(e.target) && !toggle.contains(e.target) && nav.classList.contains('active')) {
            closeMenu();
        }
    }
});

// Button hover effects
document.addEventListener('DOMContentLoaded', function() {
    document.querySelectorAll('.btn').forEach(btn => {
        btn.addEventListener('mouseenter', function() {
            this.style.transform = 'translateY(-5px) scale(1.05)';
        });
        btn.addEventListener('mouseleave', function() {
            this.style.transform = 'translateY(0) scale(1)';
        });
    });
});

// Form submissions
const contactForm = document.getElementById('contactForm');
const newsletterForm = document.getElementById('newsletterForm');

if (contactForm) {
    contactForm.addEventListener('submit', async function(e) {
        e.preventDefault();
        try {
            const response = await fetch(this.action, {
                method: 'POST',
                body: new FormData(this),
                headers: { 'Accept': 'application/json' }
            });
            if (response.ok) {
                document.getElementById('contactSuccess').style.display = 'block';
                this.reset();
                setTimeout(() => {
                    document.getElementById('contactSuccess').style.display = 'none';
                }, 5000);
            }
        } catch (error) {
            alert('There was an error sending your message. Please try again.');
        }
    });
}

if (newsletterForm) {
    newsletterForm.addEventListener('submit', async function(e) {
        e.preventDefault();
        try {
            const response = await fetch(this.action, {
                method: 'POST',
                body: new FormData(this),
                headers: { 'Accept': 'application/json' }
            });
            if (response.ok) {
                document.getElementById('newsletterSuccess').style.display = 'block';
                this.reset();
                setTimeout(() => {
                    document.getElementById('newsletterSuccess').style.display = 'none';
                }, 5000);
            }
        } catch (error) {
            alert('There was an error with your subscription. Please try again.');
        }
    });
}
