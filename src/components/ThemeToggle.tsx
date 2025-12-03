"use client"

import * as React from "react"
import { Moon, Sun, Monitor } from "lucide-react"
import { useTheme } from "next-themes"
import { clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: (string | undefined | null | false)[]) {
    return twMerge(clsx(inputs))
}

export function ThemeToggle() {
    const { setTheme, theme } = useTheme()
    const [mounted, setMounted] = React.useState(false)

    React.useEffect(() => {
        setMounted(true)
    }, [])

    if (!mounted) {
        return (
            <div className="flex items-center p-1 border rounded-full bg-background border-border">
                <div className="w-8 h-8 rounded-full bg-muted animate-pulse" />
                <div className="w-8 h-8 rounded-full" />
                <div className="w-8 h-8 rounded-full" />
            </div>
        )
    }

    return (
        <div className="flex items-center p-1 border rounded-full bg-background border-border shadow-sm">
            <button
                onClick={() => setTheme("light")}
                className={cn(
                    "p-2 rounded-full transition-all duration-200 hover:bg-muted focus:outline-none focus:ring-2 focus:ring-primary/20",
                    theme === "light" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground"
                )}
                aria-label="Light Mode"
            >
                <Sun className="w-4 h-4" />
            </button>
            <button
                onClick={() => setTheme("system")}
                className={cn(
                    "p-2 rounded-full transition-all duration-200 hover:bg-muted focus:outline-none focus:ring-2 focus:ring-primary/20",
                    theme === "system" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground"
                )}
                aria-label="System Mode"
            >
                <Monitor className="w-4 h-4" />
            </button>
            <button
                onClick={() => setTheme("dark")}
                className={cn(
                    "p-2 rounded-full transition-all duration-200 hover:bg-muted focus:outline-none focus:ring-2 focus:ring-primary/20",
                    theme === "dark" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground"
                )}
                aria-label="Dark Mode"
            >
                <Moon className="w-4 h-4" />
            </button>
        </div>
    )
}
