"use client";

import { useState } from "react";
import {
  ArrowUpRight,
  ChevronRight,
  Sailboat,
  Menu as MenuIcon,
  Plus,
  X,
} from "lucide-react";

const images = {
  hero: "https://images.pexels.com/photos/8951244/pexels-photo-8951244.jpeg?auto=compress&cs=tinysrgb&w=1800",
  menu: "https://images.pexels.com/photos/15476268/pexels-photo-15476268.jpeg?auto=compress&cs=tinysrgb&w=1000",
  reservation:
    "https://images.pexels.com/photos/17146256/pexels-photo-17146256.jpeg?auto=compress&cs=tinysrgb&w=1000",
  story:
    "https://images.pexels.com/photos/17593510/pexels-photo-17593510.jpeg?auto=compress&cs=tinysrgb&w=1400",
};

const dishes = [
  {
    name: "Toro & Caviar",
    detail: "Bluefin · finger lime · kombu",
    price: "38",
  },
  {
    name: "Ember Salmon",
    detail: "Miso glaze · shiso · smoked roe",
    price: "29",
  },
  {
    name: "Black Garlic Ramen",
    detail: "Wagyu · egg · roasted garlic",
    price: "26",
  },
];

function EditorialCard({
  image,
  label,
  eyebrow,
  href,
}: {
  image: string;
  label: string;
  eyebrow: string;
  href: string;
}) {
  return (
    <a href={href} className="editorial-card group">
      <img src={image} alt="" />
      <div className="card-scrim" />
      <div className="card-content">
        <span>{eyebrow}</span>
        <div className="card-label-row">
          <strong>{label}</strong>
          <span className="plus-button" aria-hidden="true">
            <Plus size={16} strokeWidth={1.5} />
          </span>
        </div>
      </div>
    </a>
  );
}

export default function Home() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <main className="site-shell">
      <section className="hero-section" id="home">
        <div className="hero-image-wrap">
          <img
            className="hero-image"
            src={images.hero}
            alt="Chef preparing an artful plate of sushi"
          />
          <div className="hero-scrim" />
          <div className="grain" />
        </div>

        <header className="floating-nav">
          <button
            className="menu-toggle"
            onClick={() => setMenuOpen((open) => !open)}
            aria-label={menuOpen ? "Close navigation" : "Open navigation"}
          >
            {menuOpen ? <X size={16} /> : <MenuIcon size={16} />}
          </button>
          <a href="#home" className="wordmark">
            QITCHEN
          </a>
          <nav
            className={menuOpen ? "nav-links is-open" : "nav-links"}
            aria-label="Primary navigation"
          >
            <a href="#menu" onClick={() => setMenuOpen(false)}>
              MENU
            </a>
            <a href="#story" onClick={() => setMenuOpen(false)}>
              ABOUT
            </a>
            <a
              href="/sign-in"
              className="nav-signin"
              onClick={() => setMenuOpen(false)}
            >
              SIGN IN
            </a>
            <a
              href="/sign-in"
              className="nav-cta"
              onClick={() => setMenuOpen(false)}
            >
              BOOK A TABLE <ArrowUpRight size={13} />
            </a>
          </nav>
        </header>

        <div className="hero-copy">
          <p className="eyebrow hero-eyebrow">
            Contemporary Japanese dining · Manila
          </p>
          <h1>
            SUSHI
            <br />
            <em>SENSATION</em>
          </h1>
          <p className="hero-intro">
            A quiet celebration of the sea, shaped by fire, season, and the
            hands that bring it to your table.
          </p>
        </div>

        <div className="hero-meta">
          <span>
            01 <i /> 03
          </span>
          <div className="socials">
            <a href="#instagram" aria-label="Instagram">
              <Sailboat size={16} />
            </a>
            <a href="#contact" aria-label="Contact">
              <ArrowUpRight size={16} />
            </a>
          </div>
        </div>

        <aside className="hero-rail" aria-label="Explore Qitchen">
          <EditorialCard
            image={images.menu}
            label="Menu"
            eyebrow="Explore the kitchen"
            href="#menu"
          />
          <EditorialCard
            image={images.reservation}
            label="Reservation"
            eyebrow="Join us at the counter"
            href="/sign-in"
          />
          <EditorialCard
            image={images.story}
            label="Our story"
            eyebrow="Behind the plate"
            href="#story"
          />
        </aside>
      </section>

      <section className="menu-section section-pad" id="menu">
        <div className="section-heading">
          <div>
            <p className="eyebrow">A taste of Qitchen</p>
            <h2>Made for lingering.</h2>
          </div>
          <a href="#reservation" className="text-link">
            View full menu <ChevronRight size={16} />
          </a>
        </div>
        <div className="dish-list">
          {dishes.map((dish, index) => (
            <a className="dish-row" href="#reservation" key={dish.name}>
              <span className="dish-number">0{index + 1}</span>
              <div>
                <h3>{dish.name}</h3>
                <p>{dish.detail}</p>
              </div>
              <span className="dish-price">₱{dish.price}</span>
              <ArrowUpRight className="dish-arrow" size={18} />
            </a>
          ))}
        </div>
      </section>

      <section className="story-section section-pad" id="story">
        <div className="story-photo">
          <img src={images.story} alt="Warmly lit Qitchen dining room" />
          <div className="grain" />
        </div>
        <div className="story-copy">
          <p className="eyebrow">Our story</p>
          <h2>
            Simple things,
            <br />
            <em>deeply felt.</em>
          </h2>
          <p>
            Qitchen is a small room with a big affection for the Japanese table.
            We source with intention, cook with restraint, and leave space for
            the people and conversations that make a meal memorable.
          </p>
          <a href="#reservation" className="outline-button">
            Meet us at the table <ArrowUpRight size={15} />
          </a>
        </div>
      </section>

      <section className="reservation-section" id="reservation">
        <div className="grain" />
        <p className="eyebrow">Your table is waiting</p>
        <h2>
          Come hungry.
          <br />
          <em>Leave changed.</em>
        </h2>
        <a href="/sign-in" className="cream-button">
          Book a table <ArrowUpRight size={16} />
        </a>
        <p className="reservation-note">
          Open Tuesday — Sunday · 5:30 PM — 11:00 PM
        </p>
      </section>

      <footer>
        <a href="#home" className="wordmark">
          QITCHEN
        </a>
        <span>© 2024 Qitchen Manila</span>
        <a href="mailto:hello@qitchen.ph">hello@qitchen.ph</a>
      </footer>
    </main>
  );
}
