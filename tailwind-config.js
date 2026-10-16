
        tailwind.config = {
            darkMode: 'class',
            theme: {
                extend: {
                    colors: {
                        brand: {
                            red: '#E50914',
                            neon: '#FF2A2A',
                            dark: '#07080A',
                            card: '#111319',
                            surface: '#181A22',
                            accent: '#232733'
                        }
                    },
                    fontFamily: {
                        sans: ['Inter', 'sans-serif'],
                        heading: ['Oswald', 'sans-serif'],
                    },
                    boxShadow: {
                        'neon-red': '0 0 18px rgba(229, 9, 20, 0.45), 0 0 35px rgba(229, 9, 20, 0.25)',
                        'neon-white': '0 0 18px rgba(255, 255, 255, 0.35), 0 0 35px rgba(255, 255, 255, 0.16)',
                        'glow-lg': '0 0 30px rgba(255, 42, 42, 0.6)',
                    }
                }
            }
        }
    