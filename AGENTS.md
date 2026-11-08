# Antigravity Agent Guidelines & Learned Capabilities

This repository is equipped with specialized design, motion, and 3D capabilities discovered in `.agent/skills/`. The agent permanently retains and applies these skills across all development tasks.

---

## 1. Design DNA (`design-dna`)
* **3 Dimensions of Design Identity**:
  1. **Design System (Tokens)**: Exact measurable values for color palettes (light-to-dark neutral scales, primary, secondary, semantic accents), typography scale, spacing grids, elevation shadows, and corner radii.
  2. **Design Style (Feel)**: Intentional mood, visual hierarchy, whitespace philosophy, and brand personality without AI slop.
  3. **Visual Effects (Advanced Rendering)**: Special rendering including Canvas 2D, WebGL/Three.js 3D elements, SVG animations, and scroll-linked dynamics.
* **Standards**:
  * Never approximate colors by eye when an image reference is provided; measure exact hex codes and maintain proper WCAG contrast.
  * Ensure high visual polish with coherent tokens across components.

---

## 2. Genjutsu Creative Coding (`genjutsu`)
* **Anti-AI-Slop Manifesto**:
  * Reject generic, unmotivated gradient blobs, gratuitous glassmorphism, or cliché animations.
  * Every micro-interaction must serve an emotional or functional purpose.
* **Pipelines**:
  * **Cast (`/genjutsu:cast`)**: Focused motion and micro-interactions for existing components. Always formulate an interaction thesis before coding.
  * **Paint (`/genjutsu:paint`)**: Complete visual identity and design system generation (`MASTER.md`).
  * **Bunshin (`/genjutsu:bunshin`)**: Full-scale application design and parallelized page generation.
* **Performance Mandate**:
  * Target 60fps. Animate only GPU-accelerated properties (`transform` and `opacity`).
  * Avoid layout thrashing and unneeded repaints.

---

## 3. Motion Design Principles (`motion-design`)
* **Timing & Duration Rules**:
  * Micro-interactions / buttons / hovers: 100ms – 200ms.
  * Modals, dropdowns, and drawers: 200ms – 350ms.
  * Large page / view transitions: 300ms – 500ms.
* **Easing Rules**:
  * Entrance transitions: Decelerate (ease-out).
  * Exit transitions: Accelerate (ease-in).
  * Natural movement: Smooth spring or custom cubic-bezier (e.g. `cubic-bezier(0.16, 1, 0.3, 1)`).
* **1/3 Rule**: Keep motion travel distance within 1/3 of the element's dimension to feel snappy and grounded.
* **Accessibility**: Always respect `prefers-reduced-motion` media queries.

---

## 4. GSAP Mastery (`gsap-skills`)
* **Core APIs**: `gsap.to()`, `gsap.from()`, `gsap.fromTo()`, `gsap.timeline()`.
* **React & Next.js Integration**:
  * Use `@gsap/react`'s `useGSAP()` hook for scoped animations and automatic cleanup on unmount.
  * Guard all browser/window APIs with client-side checks (`typeof window !== 'undefined'`).
* **ScrollTrigger**:
  * Anchor scroll animations cleanly with proper trigger offsets, `scrub`, and `pin`.
  * Always kill and refresh triggers when unmounting or when layout dimensions change.

---

## 5. Three.js & WebGL 3D (`threejs-skills`)
* **Scene Architecture**:
  * Perspective & Orthographic cameras, WebGL/WebGPU renderers with proper pixel ratio clamping (`Math.min(window.devicePixelRatio, 2)`).
  * Tone mapping (`ACESFilmicToneMapping`) and color management.
* **Memory Lifecycle (Critical)**:
  * Manually dispose geometries, materials, textures, and render targets upon unmount to eliminate GPU memory leaks.
* **React Three Fiber (R3F)**:
  * Declarative 3D using `@react-three/fiber` and `@react-three/drei` within modern Next.js client components.

