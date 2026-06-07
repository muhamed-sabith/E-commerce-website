# HEYRAH

HEYRAH is a production-minded e-commerce platform.

## Brand

* Company name: HEYRAH
* Official tagline: "Wings of Style"
* Primary visual identity: Deep Teal Blue + Gold
* Style: premium, elegant, sophisticated, modern, minimal, fashion-forward, refined, luxurious, professional
* The storefront should feel like a premium international fashion/lifestyle brand
* Do not copy another company's exact design, branding, layout, or assets

Use the tagline "Wings of Style" only where it improves the brand presentation. Do not place it everywhere.

## Brand reference

* Official logo reference: `public/brand/heyrah-logo-reference.jpg`
* The reference shows the intended identity relationship: dark/deep teal background, metallic/warm gold typography and logo elements
* Use it as the visual anchor for brand mood — teal, gold, typography, spacing, and the luxury/premium feeling
* It is a brand reference, not a website layout template

## Logo rules

The HEYRAH logo is an important brand asset.

Do not:

* redraw it unnecessarily
* distort or stretch it
* change its proportions
* create random alternative logos
* replace it with a generic text logo
* change the brand spelling
* remove the HEYRAH identity

When the logo is used in the website, preserve its proportions and visual character.

## Color usage

Use the colors with restraint.

* Do not make the entire website gold
* Do not make the entire website teal

Direction:

* Deep teal for major brand surfaces and premium sections
* Teal shades for primary interface elements
* Gold for important accents, logo treatment, premium highlights, and selected details
* White/light neutral backgrounds for clean shopping areas
* Dark text for readability
* Soft neutral borders and surfaces

The exact production palette is refined during the design phase after examining the logo reference.

## Design direction

The user storefront should be:

* extremely smooth
* premium
* intuitive
* visually clean
* responsive and mobile friendly
* accessible
* fast

HEYRAH must have its own identity. Never copy another company's website, branding, logo, or other copyrighted assets.

Apple can be referenced only for qualities, not layout:

* clean composition
* premium spacing
* restrained motion
* strong typography
* product-focused presentation
* smooth interactions

## Product quality

Prioritize:

1. Correctness
2. Security
3. Reliability
4. UX
5. Performance
6. Visual polish

The final application must feel like a real HEYRAH commercial product, not a generic demo or tutorial project.

Do not knowingly leave broken functionality.

Never create fake buttons, fake filters, fake sorting, dead links, or placeholder functionality that looks finished.

## Critical correctness rules

* Backend is the source of truth.
* Never trust product prices supplied by the client.
* Prices must be treated as numeric values.
* Low-to-high sorting must be true numeric ascending sorting.
* High-to-low sorting must be true numeric descending sorting.
* Search must behave correctly.
* Filters must behave correctly.
* Search + filters + sorting must work together correctly.
* Cart calculations must be authoritative and validated server-side.
* Stock must never become negative.
* Out-of-stock products must not be purchasable.
* Inventory updates must be safe against concurrent purchases.
* Users must not access admin functionality.
* Users must not access another user's protected data.
* Authorization must be enforced server-side.
* Strict USER/ADMIN separation.
* Critical business logic must have automated tests.

## UI rules

The user storefront is the visual priority.

Use:

* excellent spacing
* refined typography
* clear visual hierarchy
* responsive layouts
* smooth but restrained animation
* accessible interactions
* loading states
* empty states
* error states
* success feedback where appropriate

Avoid:

* generic AI-looking layouts
* excessive gradients
* excessive shadows
* excessive gold
* excessive animation
* visual clutter
* inconsistent spacing
* inconsistent typography
* inconsistent components

## Admin module

The admin interface should be:

* simple
* clean
* professional
* efficient
* easy to operate

It should use the HEYRAH brand subtly without becoming visually excessive.

## Skills

The project skills are already installed. Do not reinstall, remove, replace, or modify any skill. Do not modify `skills-lock.json`.

Use the smallest relevant skill set for each task.

Use:

* `design-taste-frontend` for establishing visual direction and design taste
* `frontend-design` for frontend implementation
* `designing-user-experience` for UX and interaction design
* `building-accessible-interfaces` for accessibility
* `reviewing-interface-quality` for reviewing and critiquing finished interfaces
* `impeccable` mainly for later visual refinement and polishing
* `testing-webapps` for browser and functional testing

Do not unnecessarily load all skills for every task.

## Development discipline

Before implementing a major feature:

* understand the requirement
* inspect the existing code
* identify dependencies
* implement carefully
* test the feature
* test important edge cases
* verify responsive behavior
* verify error handling

Do not claim a feature is complete without verification.

## Testing priorities

Always pay special attention to:

* sorting
* filtering
* search
* cart calculations
* inventory
* authorization
* authentication
* checkout
* order creation
* responsive behavior

## Code quality

Prefer:

* reusable components
* clear naming
* separation of concerns
* reusable validation
* reusable business logic
* maintainable database access
* minimal duplication

Avoid:

* giant components
* unnecessary abstraction
* duplicated business logic
* hardcoded secrets
* unsafe client-side trust
* dead code
