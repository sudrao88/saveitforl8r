
import React from 'react';

export const Logo = ({ className }: { className?: string }) => (
  <div className={`${className} shrink-0`}>
    <svg viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
      <rect width="512" height="512" rx="128" fill="#2563eb"/>
      <path d="M356.5 125.5C373.069 108.931 399.931 108.931 416.5 125.5C433.069 142.069 433.069 168.931 416.5 185.5L206.5 395.5L100 420L124.5 313.5L334.5 103.5L356.5 125.5Z" stroke="white" strokeWidth="36" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M312 170L372 230" stroke="white" strokeWidth="36" strokeLinecap="round"/>
      <path d="M100 420L180 440" stroke="white" strokeWidth="36" strokeLinecap="round" strokeOpacity="0.5"/>
    </svg>
  </div>
);

export const KeyOff = ({ size = 24, className = "" }: { size?: number, className?: string }) => (
  <svg 
    xmlns="http://www.w3.org/2000/svg" 
    height={size} 
    width={size}
    viewBox="0 -960 960 960"
    fill="currentColor"
    className={className}
  >
    <path d="M790-57 488-359q-32 54-87 86.5T280-240q-100 0-170-70T40-480q0-66 32.5-121t86.5-87L57-790l57-56 732 733-56 56Zm50-543 120 120-183 183-127-126 50-37 72 54 75-74-40-40H553l-80-80h367ZM280-320q51 0 90.5-27.5T428-419l-56-56-48.5-48.5L275-572l-56-56q-44 18-71.5 57.5T120-480q0 66 47 113t113 47Zm0-80q-33 0-56.5-23.5T200-480q0-33 23.5-56.5T280-560q33 0 56.5 23.5T360-480q0 33-23.5 56.5T280-400Z"/>
  </svg>
);
