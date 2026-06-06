import React, { useRef, useMemo, useState, useEffect } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Float, Stars } from '@react-three/drei';
import * as THREE from 'three';

function FloatingParticles({ count = 200 }) {
  const mesh = useRef();
  const positions = useMemo(() => {
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count * 3; i += 3) {
      pos[i] = (Math.random() - 0.5) * 30;
      pos[i + 1] = (Math.random() - 0.5) * 30;
      pos[i + 2] = (Math.random() - 0.5) * 30;
    }
    return pos;
  }, [count]);

  useFrame((state) => {
    if (mesh.current) {
      mesh.current.rotation.x = state.clock.elapsedTime * 0.03;
      mesh.current.rotation.y = state.clock.elapsedTime * 0.05;
    }
  });

  return (
    <points ref={mesh}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          count={count}
          array={positions}
          itemSize={3}
        />
      </bufferGeometry>
      <pointsMaterial
        size={0.05}
        color="#6366f1"
        transparent
        opacity={0.6}
        sizeAttenuation
      />
    </points>
  );
}

function HexGrid() {
  const ref = useRef();

  useFrame((state) => {
    if (ref.current) {
      ref.current.rotation.x = Math.PI / 6;
      ref.current.rotation.z = state.clock.elapsedTime * 0.02;
    }
  });

  const hexagons = useMemo(() => {
    const items = [];
    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * Math.PI * 2;
      const radius = 3 + Math.random() * 2;
      items.push({
        position: [
          Math.cos(angle) * radius,
          Math.sin(angle) * radius,
          (Math.random() - 0.5) * 2
        ],
        scale: 0.3 + Math.random() * 0.4,
        speed: 0.5 + Math.random() * 1.5
      });
    }
    return items;
  }, []);

  return (
    <group ref={ref}>
      {hexagons.map((hex, i) => (
        <Float key={i} speed={hex.speed} rotationIntensity={0.5} floatIntensity={1}>
          <mesh position={hex.position} scale={hex.scale}>
            <icosahedronGeometry args={[1, 0]} />
            <meshStandardMaterial
              color="#6366f1"
              transparent
              opacity={0.15}
              wireframe
            />
          </mesh>
        </Float>
      ))}
    </group>
  );
}

function ShieldModel() {
  const ref = useRef();

  useFrame((state) => {
    if (ref.current) {
      ref.current.rotation.y = state.clock.elapsedTime * 0.3;
      ref.current.position.y = Math.sin(state.clock.elapsedTime * 0.5) * 0.3;
    }
  });

  return (
    <Float speed={2} rotationIntensity={0.3} floatIntensity={0.8}>
      <group ref={ref} scale={1.2}>
        {/* Shield body */}
        <mesh position={[0, 0, 0]}>
          <sphereGeometry args={[1, 32, 32]} />
          <meshStandardMaterial
            color="#6366f1"
            transparent
            opacity={0.08}
            wireframe
          />
        </mesh>
        {/* Inner ring */}
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[1.2, 0.02, 16, 64]} />
          <meshStandardMaterial
            color="#06b6d4"
            emissive="#06b6d4"
            emissiveIntensity={0.5}
            transparent
            opacity={0.6}
          />
        </mesh>
        {/* Outer ring */}
        <mesh rotation={[Math.PI / 3, Math.PI / 4, 0]}>
          <torusGeometry args={[1.5, 0.015, 16, 64]} />
          <meshStandardMaterial
            color="#8b5cf6"
            emissive="#8b5cf6"
            emissiveIntensity={0.4}
            transparent
            opacity={0.4}
          />
        </mesh>
        {/* Center eye */}
        <mesh position={[0, 0, 0]}>
          <octahedronGeometry args={[0.3, 0]} />
          <meshStandardMaterial
            color="#06b6d4"
            emissive="#06b6d4"
            emissiveIntensity={1}
            transparent
            opacity={0.7}
          />
        </mesh>
      </group>
    </Float>
  );
}

function CSSFallback() {
  return (
    <div className="absolute inset-0 opacity-20 pointer-events-none overflow-hidden">
      {[...Array(40)].map((_, i) => (
        <div
          key={i}
          className="absolute rounded-full bg-indigo-500/30"
          style={{
            width: `${2 + Math.random() * 5}px`,
            height: `${2 + Math.random() * 5}px`,
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

export default function Scene3D({ variant = 'default' }) {
  const [webglFailed, setWebglFailed] = useState(false);
  const glRef = useRef(null);

  // Cleanup WebGL context lost listener and dispose renderer on unmount
  useEffect(() => {
    if (!glRef.current) return undefined;
    const handler = (e) => {
      e.preventDefault();
      setWebglFailed(true);
    };
    const dom = glRef.current.domElement;
    dom.addEventListener('webglcontextlost', handler);
    return () => {
      dom.removeEventListener('webglcontextlost', handler);
      // Dispose of the WebGL context to free resources
      try { glRef.current.dispose(); } catch (_) {}
    };
  }, []);

  if (webglFailed) return <div className="scene-bg"><CSSFallback /></div>;

  return (
    <div className="scene-bg">
      <Canvas
        camera={{ position: [0, 0, 8], fov: 60 }}
        style={{ background: 'transparent' }}
        gl={{ alpha: true, antialias: true, failIfMajorPerformanceCaveat: false }}
        onCreated={({ gl }) => {
          glRef.current = gl;
        }}
      >
        <ambientLight intensity={0.3} />
        <pointLight position={[10, 10, 10]} intensity={0.5} color="#6366f1" />
        <pointLight position={[-10, -10, -10]} intensity={0.3} color="#06b6d4" />

        <Stars
          radius={50}
          depth={50}
          count={3000}
          factor={3}
          saturation={0}
          fade
          speed={0.5}
        />

        <FloatingParticles count={150} />
        <HexGrid />

        {variant === 'login' && <ShieldModel />}

        <fog attach="fog" args={['#030712', 8, 25]} />
      </Canvas>
    </div>
  );
}
