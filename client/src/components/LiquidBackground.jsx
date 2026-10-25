import React from 'react';

export default function LiquidBackground() {
  return (
    <div className="fixed inset-0 pointer-events-none -z-10 overflow-hidden">
      {/* Deep Obsidian Canvas */}
      <div className="absolute inset-0 bg-[#0b0c10]" />

      {/* Floating Ambient Light Orbs (Apple visionOS mesh) */}
      <div 
        className="absolute -top-[15%] -left-[10%] w-[55vw] h-[55vw] rounded-full opacity-25 blur-[120px] animate-pulse"
        style={{
          background: 'radial-gradient(circle, rgba(56, 189, 248, 0.35) 0%, rgba(99, 102, 241, 0.15) 50%, transparent 80%)',
          animationDuration: '14s'
        }}
      />
      
      <div 
        className="absolute top-[35%] -right-[15%] w-[50vw] h-[50vw] rounded-full opacity-20 blur-[130px]"
        style={{
          background: 'radial-gradient(circle, rgba(168, 85, 247, 0.3) 0%, rgba(59, 130, 246, 0.1) 60%, transparent 80%)'
        }}
      />

      <div 
        className="absolute -bottom-[20%] left-[25%] w-[60vw] h-[60vw] rounded-full opacity-20 blur-[140px]"
        style={{
          background: 'radial-gradient(circle, rgba(236, 72, 153, 0.2) 0%, rgba(99, 102, 241, 0.15) 50%, transparent 80%)'
        }}
      />

      {/* Subtle Noise Texture Overlay */}
      <div className="absolute inset-0 bg-[radial-gradient(rgba(255,255,255,0.03)_1px,transparent_1px)] [background-size:24px_24px] opacity-60" />
    </div>
  );
}
