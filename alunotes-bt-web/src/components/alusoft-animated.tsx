"use client";

import React, { useEffect, useRef } from "react";
import anime from "animejs";
import { cn } from "~/lib/utils";

// Hardcoded Coordinates from your requirements
const LIQUID_CX = 42;
const LIQUID_CY = 89.5;
const LIQUID_R = 25.5;
const GAP_X = 42;
const GAP_Y = 52.5;

export default function AlusoftAnimated({
    gapColor = "background",
    letterColor = "black dark:fill-white"
}: {
    gapColor?: string;
    letterColor?: string;
}) {
    const bubbleLayerRef = useRef<SVGGElement>(null);

    // Setup Animations
    useEffect(() => {
        // --- WAVE ANIMATIONS ---
        // Translate exactly 200px for the seamless loop
        const waveBackAnim = anime({
            targets: "#wave-back",
            translateX: [0, -200],
            easing: "linear",
            duration: 4000,
            loop: true,
        });

        const waveFrontAnim = anime({
            targets: "#wave-front",
            translateX: [-200, 0],
            easing: "linear",
            duration: 2500,
            loop: true,
        });

        // --- BUBBLE SYSTEM ---
        const createBubble = () => {
            if (!bubbleLayerRef.current) return;

            const bubble = document.createElementNS(
                "http://www.w3.org/2000/svg",
                "circle"
            );
            bubble.classList.add("bubble");

            // Random Radius
            const r = anime.random(2, 5);
            bubble.setAttribute("r", String(r));

            // Spawn Position: Random X inside the liquid radius
            const safeZone = LIQUID_R * 0.5;
            const startX = anime.random(LIQUID_CX - safeZone, LIQUID_CX + safeZone);
            const startY = anime.random(LIQUID_CY - 5, LIQUID_CY + 10);

            bubble.setAttribute("cx", String(startX));
            bubble.setAttribute("cy", String(startY));

            // Initial style
            bubble.style.fill = "#8e44ad";
            bubble.style.opacity = "0.8";

            bubbleLayerRef.current.appendChild(bubble);

            const tl = anime.timeline({
                easing: "linear",
                complete: () => {
                    if (bubble.parentNode) bubble.remove();
                },
            });

            // Random scatter destination at top
            const endX = anime.random(15, 85);

            tl
                // Stage 1: Funnel up to the gap
                .add({
                    targets: bubble,
                    translateX: GAP_X - startX,
                    translateY: GAP_Y - startY,
                    scale: 0.8,
                    duration: 1200,
                    easing: "easeInSine",
                })
                // Stage 2: Escape upwards
                .add({
                    targets: bubble,
                    translateY: -150,
                    translateX: endX - startX,
                    scale: [0.8, 1.2],
                    opacity: 0,
                    duration: 2200,
                    easing: "easeOutSine",
                });
        };

        // Spawn bubbles rapidly
        const intervalId = setInterval(createBubble, 250);

        // Cleanup function
        return () => {
            clearInterval(intervalId);
            waveBackAnim.pause();
            waveFrontAnim.pause();
            // Remove any remaining bubbles
            if (bubbleLayerRef.current) {
                bubbleLayerRef.current.innerHTML = "";
            }
        };
    }, []);

    return (
        <div className="flex justify-center items-center h-full w-full overflow-hidden font-sans">
            <div className="relative w-full h-auto">
                <svg
                    viewBox="0 0 100 170"
                    xmlns="http://www.w3.org/2000/svg"
                    className="w-full"
                    preserveAspectRatio="xMidYMid meet"
                >
                    <defs>
                        <clipPath id="bowl-mask">
                            <circle cx={LIQUID_CX} cy={LIQUID_CY} r={LIQUID_R} />
                        </clipPath>
                    </defs>

                    {/* 1. LIQUID LAYER */}
                    <g clipPath="url(#bowl-mask)">
                        {/* Background tint */}
                        <rect
                            x="0"
                            y="0"
                            width="100"
                            height="150"
                            fill="#e0d4e8"
                            opacity="0.3"
                        />

                        {/* LIQUID GROUP (Translated to center Y) */}
                        <g id="liquid-group" transform={`translate(0, ${LIQUID_CY})`}>
                            {/* Back Wave */}
                            <path
                                className="fill-[#4b1e6e]"
                                id="wave-back"
                                d="M-400,0 C-350,15 -350,-15 -300,0 S-250,-15 -200,0 S-150,15 -100,0 S-50,-15 0,0 S50,15 100,0 S150,-15 200,0 S250,15 300,0 V 200 H-400 Z"
                            />
                            {/* Front Wave */}
                            <path
                                className="fill-[#662d91] opacity-90"
                                id="wave-front"
                                d="M-400,0 C-350,18 -350,-18 -300,0 S-250,-18 -200,0 S-150,18 -100,0 S-50,-18 0,0 S50,18 100,0 S150,-18 200,0 S250,18 300,0 V 200 H-400 Z"
                            />
                        </g>
                    </g>

                    {/* 2. THE SOLID LETTER */}
                    <path
                        className={cn(
                            "z-10 transition-colors duration-200",
                            letterColor === "primary-foreground" ? "fill-primary-foreground" : "fill-black dark:fill-white"
                        )}
                        d="M1363.12,2014.16l-.34,12.83a18.21,18.21,0,0,0-5.33-6.75,35,35,0,0,0-9.82-5.74c-.39-.16-.78-.27-1.17-.4v14.8a21.53,21.53,0,0,1,3.66,1.75,22.42,22.42,0,0,1,8.17,8.83,27,27,0,0,1,3,12.83v1.16q0,10.67-6.5,17.24a21.58,21.58,0,0,1-16,6.58q-10.83,0-16.58-6.91t-5.74-18.07q0-11,5.83-17.91a18.62,18.62,0,0,1,9-5.88v-16.19a37,37,0,0,0-16.15,4.83,33.47,33.47,0,0,0-13.08,14,45.59,45.59,0,0,0-4.58,21q0,12.17,5.25,21.24a36.78,36.78,0,0,0,14,14,38.31,38.31,0,0,0,19.07,4.91a31.53,31.53,0,0,0,16.82-4.58q7.5-4.57,10.33-10.58l.33,13.5h17v-76.46Z"
                        transform="translate(-1296.99 -1962.73)"
                    />

                    {/* 3. THE GAP PATCH */}
                    <circle
                        className={cn(
                            "transition-colors duration-200",
                            gapColor === "primary" ? "fill-primary" :
                                gapColor === "muted" ? "fill-muted" :
                                    "fill-background"
                        )}
                        cx={GAP_X}
                        cy={GAP_Y}
                        r="7"
                    />

                    {/* 4. BUBBLES LAYER */}
                    <g ref={bubbleLayerRef} id="bubble-layer" />
                </svg>
            </div>
        </div>
    );
}
