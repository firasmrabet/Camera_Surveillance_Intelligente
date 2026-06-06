import React, { useRef, useMemo, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Stars } from '@react-three/drei';
import * as THREE from 'three';

function FloatingOrbs() {
  const ref = useRef();
  const count = 50;

  const positions = useMemo(() => {
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count * 3; i += 3) {
      pos[i] = (Math.random() - 0.5) * 20;
      pos[i + 1] = (Math.random() - 0.5) * 20;
      pos[i + 2] = (Math.random() - 0.5) * 10;
    }
    return pos;
  }, []);

  useFrame((state) => {
    if (ref.current) {
      ref.current.rotation.y = state.clock.elapsedTime * 0.01;
      ref.current.rotation.x = state.clock.elapsedTime * 0.005;
    }
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" count={count} array={positions} itemSize={3} />
      </bufferGeometry>
      <pointsMaterial size={0.08} color="#6366f1" transparent opacity={0.4} sizeAttenuation />
    </points>
  );
}

function WebGLFallback() {
  return (
    <div className="absolute inset-0 opacity-20 pointer-events-none overflow-hidden">
      {[...Array(30)].map((_, i) => (
        <div
          key={i}
          className="absolute rounded-full bg-indigo-500/30"
          style={{
            width: `${2 + Math.random() * 4}px`,
            height: `${2 + Math.random() * 4}px`,
            left: `${Math.random() * 100}%`,
            top: `${Math.random() * 100}%`,
            animation: `float ${3 + Math.random() * 4}s ease-in-out infinite`,
            animationDelay: `${Math.random() * 3}s`
          }}
        />
      ))}
    </div>
  );
}

export default function Scene3DMini() {
  const [webglFailed, setWebglFailed] = useState(false);

  if (webglFailed) return <WebGLFallback />;

  return (
    <div className="absolute inset-0 opacity-40 pointer-events-none">
      <Canvas
        camera={{ position: [0, 0, 6], fov: 50 }}
        gl={{ alpha: true, failIfMajorPerformanceCaveat: false }}
        onCreated={({ gl }) => {
          gl.domElement.addEventListener('webglcontextlost', (e) => {
            e.preventDefault();
            setWebglFailed(true);
          });
        }}
      >
        <ambientLight intensity={0.2} />
        <FloatingOrbs />
        <Stars radius={30} depth={30} count={1500} factor={2} fade speed={0.3} />
        <fog attach="fog" args={['#030712', 5, 15]} />
      </Canvas>
    </div>
  );
}
