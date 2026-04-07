# Design System Document: Multi-Theme Editorial Framework



## 1. Overview & Creative North Star: "The Ethereal Curator"



This design system is built to transcend the standard "SaaS-blocky" aesthetic. It moves away from rigid grids and 1px borders toward a philosophy of **Atmospheric Depth**. By leveraging high-contrast editorial typography and tonal layering, the system creates a space that feels curated, not just programmed.



The system operates across two distinct emotional states:

* **Dark Mode (Obsidian Glow):** A high-drama, immersive environment focusing on neon luminescence against deep, obsidian-like voids.

* **Light Mode (Daylight Sanctuary):** An airy, high-transparency experience using "Ethereal Slate" and "Frosted Glass" to create a sense of weightlessness and clarity.



**The signature look is achieved through:**

* **Intentional Asymmetry:** Overlapping elements and varied column widths that break the "template" feel.

* **Tonal Definition:** Using color shifts rather than lines to define boundaries.

* **Editorial Scale:** Using massive `display-lg` typography contrasted with tight, functional `label-sm` details.



---



## 2. Colors & Atmospheric Tokens



### Theme 1: Obsidian Glow (Dark)

Maintains the original deep-ink aesthetic. Focus on high-contrast neon accents against the `#0b0f10` inverse surface. The `color_mode` for the system is currently set to `dark`.



### Theme 2: Daylight Sanctuary (Light)

A palette designed to feel like light passing through a prism.



| Token | Hex | Role |

| :--- | :--- | :--- |

| `background` | `#F8FAFC` | The base "Ethereal Slate" canvas, derived from `neutral_color_hex`. |

| `primary` | `#7CB9E8` | Deep cyan for critical actions, directly from `primary_color_hex`. |

| `secondary` | `#9D85FF` | Soft purple for secondary accents, directly from `secondary_color_hex`. |

| `tertiary` | `#CFFAFE` | An additional accent color, directly from `tertiary_color_hex`. |



### The "No-Line" Rule

**Explicit Instruction:** Designers are prohibited from using 1px solid borders to section off content. Boundaries must be defined solely through:

1. **Background Shifts:** Placing a lighter surface card on a base background or slightly darker section.

2. **Soft Gradients:** Using the **Signature Texture** (a 45-degree linear gradient from `primary` to `secondary`) to define headers or key call-to-actions.



### Glass & Gradient Rule

For the Light Mode, all primary containers should utilize **Glassmorphism**.

* **Formula:** `surface-container-lowest` at 60% opacity + `backdrop-filter: blur(24px)`.

* This ensures the "ambient glows" of the background bleed through the UI, making it feel integrated rather than "pasted on."



---



## 3. Typography: Editorial Sophistication



We utilize a dual-font strategy to maintain the specific brand personality of each theme while sharing a unified high-contrast scale.



* **Dark Mode:** Uses **Inter** for a sharp, technical, and modern digital feel. The current `headline_font`, `body_font`, and `label_font` are all set to `inter`.

* **Light Mode:** Uses **Manrope** for an organic, geometric, and high-end editorial feel.



### The Scale

| Level | Font | Size | Weight / Usage |

| :--- | :--- | :--- | :--- |

| `display-lg` | Inter/Manrope | 3.5rem | Negative letter-spacing (-0.02em). Use for Hero headlines. |

| `headline-md` | Inter/Manrope | 1.75rem | High-contrast section headers. |

| `title-sm` | Inter/Manrope | 1.0rem | Bold. For card headers and navigational anchors. |

| `body-lg` | Inter/Manrope | 1.0rem | Regular. Optimized for long-form reading. |

| `label-md` | Inter/Manrope | 0.75rem | Uppercase with +0.05em tracking for utility labels. |



---



## 4. Elevation & Depth: The Layering Principle



Depth in this system is achieved through **Tonal Layering** rather than traditional structural lines.



* **The Layering Stack:**

* **Level 0 (Base):** `background` (`#F8FAFC`)

* **Level 1 (Sections):** A slightly darker variation of the background.

* **Level 2 (Cards):** A slightly lighter variation of the background.

* **Ambient Shadows:** For "floating" elements (like Modals or Popovers), use extra-diffused shadows: `box-shadow: 0 20px 40px rgba(124, 185, 232, 0.06)`. Note the shadow uses a tinted version of the `primary_color_hex` (`#7CB9E8`), not pure black.

* **Ghost Borders:** If a border is required for accessibility, use a very light, low-opacity border (e.g., 15% opacity). Never use a 100% opaque border.



---



## 5. Components: Fluidity & Softness



All components inherit a **maximum (pill-shaped)** radius to maintain the "Sanctuary" aesthetic, as indicated by a `roundedness` value of 3.



### Buttons

* **Primary:** A gradient-fill (Primary to Secondary). Pill-shaped. High-gloss finish.

* **Secondary:** Glassmorphic background (Surface-lowest @ 20% opacity) with a "Ghost Border."

* **Interaction:** On hover, the glass blur increases from 24px to 40px.



### Cards & Lists

* **Prohibition:** No divider lines.

* **Separation:** Use a moderate level of vertical white space (from the Spacing Scale, currently set to `spacing: 2`) or subtle background shifts between surface tiers to separate content items.

* **Nesting:** Cards should appear to "float" within their parent container using a slightly lighter surface tone.



### Input Fields

* **Style:** Minimalist. No bottom line. Instead, use a slightly darker rounded capsule.

* **Active State:** The "Ghost Border" transitions to a `primary` glow (8px spread, 10% opacity).



### Signature Component: The "Ambient Glow" Orb

* Use large, blurred radial gradients (200px-400px wide) of `primary_color_hex` and `secondary_color_hex` at 20% opacity, positioned behind content to create the "Daylight Sanctuary" atmosphere.



---



## 6. Do's and Don'ts



### Do

* **Do** use asymmetrical margins. If the left margin is 80px, try a 120px right margin for hero sections to create an editorial look.

* **Do** use a normal level of white space (`spacing: 2`). Let the content breathe; space is a luxury.

* **Do** use "Inter" for all text in dark mode to emphasize the sharp, technical feel.



### Don't

* **Don't** use 1px solid borders (the "No-Line" rule).

* **Don't** use pure black (#000000) for shadows. Always tint shadows with the surface or primary color.

* **Don't** use standard "Grid" layouts for headers. Offset the headline from the body text to create visual interest.

* **Don't** use sharp corners. Every container must respect the `roundedness` value of 3 (maximum, pill-shaped).