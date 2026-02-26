import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        ons: {
          'night-blue': '#003c57',
          'ocean-blue': '#206095',
          'sky-blue': '#27a0cc',
          'spring-green': '#a8bd3a',
          'aqua-teal': '#00a3a6',
          'leaf-green': '#0f8243',
          'ruby-red': '#d0021b',
          'jaffa-orange': '#fa6401',
          'sun-yellow': '#fbc900',
          'neon-yellow': '#f0f762',
          'black': '#222222',
          'grey-100': '#414042',
          'grey-75': '#707071',
          'grey-35': '#bcbcbd',
          'grey-15': '#e2e2e3',
          'grey-5': '#f5f5f6',
        },
      },
    },
  },
  plugins: [],
};

export default config;
