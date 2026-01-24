
import React from 'react';

export const Logo = ({ className }: { className?: string }) => (
  <div className={`${className} shrink-0`}>
    <svg viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
      <path d="M80 48H400L464 112V432C464 449.673 449.673 464 432 464H80C62.327 464 48 449.673 48 432V80C48 62.327 62.327 48 80 48Z" fill="#2563eb"/>
      <rect x="156" y="48" width="200" height="140" rx="8" fill="#e6e6ff" fillOpacity="1"/>
      <rect x="272" y="80" width="60" height="80" rx="4" fill="#2563eb" fillOpacity="0.3"/>
      <rect x="96" y="240" width="320" height="192" rx="8" fill="white"/>
      <text x="256" y="395" textAnchor="middle" fontFamily="Arial, sans-serif" fontWeight="bolder" fontSize="160" fill="#2563eb" letterSpacing="0" stroke="#2563eb" strokeWidth="5">L8R</text>
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
