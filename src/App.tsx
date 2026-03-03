import { GoogleGenAI } from "@google/genai";
import React, { useEffect, useState } from "react";
import Markdown from "react-markdown";

// ============================================================
// CORE DATA MODELS & MATH
// ============================================================
const getDispersion = (club, handicap) => {
  const baseLateral = {
    "Driver": 65, "3W": 50, "5W": 42, "3H": 38, "4H": 35,
    "3i": 32, "4i": 28, "5i": 25, "6i": 20, "7i": 17,
    "8i": 14, "9i": 11, "PW": 9, "GW": 8, "SW": 7, "LW": 6
  };
  const baseDepth = {
    "Driver": 30, "3W": 26, "5W": 23, "3H": 21, "4H": 19,
    "3i": 18, "4i": 16, "5i": 14, "6i": 12, "7i": 10,
    "8i": 9, "9i": 8, "PW": 7, "GW": 6, "SW": 5, "LW": 5
  };

  const lateralScale = 1 + handicap * 0.04;
  const depthScale = 1 + handicap * 0.06 + handicap * handicap * 0.002;

  return {
    lateral: Math.round(baseLateral[club] * lateralScale),
    depth: Math.round(baseDepth[club] * depthScale),
  };
};

const getCarry = (club, handicap) => {
  const baseCarry = {
    "Driver": 260, "3W": 240, "5W": 225, "3H": 215, "4H": 205,
    "3i": 200, "4i": 190, "5i": 180, "6i": 170, "7i": 160,
    "8i": 148, "9i": 136, "PW": 125, "GW": 112, "SW": 100, "LW": 85
  };
  const lossPerStroke = club === "Driver" ? 1.8 : club === "LW" ? 0.5 : 1.2;
  return Math.round(baseCarry[club] - handicap * lossPerStroke);
};

const estimateHandicap = (club, actualLateral, actualDepth) => {
  let bestFit = 0;
  let minDiff = Infinity;
  for (let h = -5; h <= 30; h++) {
    const d = getDispersion(club, Math.max(0, h));
    const diff = Math.abs(d.lateral - actualLateral) + Math.abs(d.depth - actualDepth);
    if (diff < minDiff) {
      minDiff = diff;
      bestFit = h;
    }
  }
  return bestFit;
};

const calcProximityYards = (carryErr, latErr) => {
  return Math.sqrt((carryErr * carryErr) + (latErr * latErr));
};

const CLUBS = ["Driver", "3W", "5W", "3H", "4H", "3i", "4i", "5i", "6i", "7i", "8i", "9i", "PW", "GW", "SW", "LW"];

// ============================================================
// UI COMPONENTS
// ============================================================
const DrillHeader = ({ title, subtitle, instructions }) => (
  <div style={{ marginBottom: "48px", borderBottom: "0.5px solid rgba(212, 175, 55, 0.3)", paddingBottom: "24px" }}>
    <h2 style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "36px", color: "#F9F9F9", margin: "0 0 12px 0", fontWeight: 400 }}>{title}</h2>
    <p style={{ fontFamily: "'Montserrat', sans-serif", fontSize: "12px", fontWeight: "600", color: "#D4AF37", margin: "0 0 24px 0", textTransform: "uppercase", letterSpacing: "2px" }}>{subtitle}</p>
    <p style={{ fontFamily: "'Montserrat', sans-serif", fontSize: "14px", lineHeight: "1.8", color: "#CCCCCC", margin: 0, maxWidth: "700px" }}>{instructions}</p>
  </div>
);

const InputField = ({ label, value, onChange, placeholder, onSubmit, disabled }) => (
  <div style={{ flex: 1 }}>
    <label style={{ fontFamily: "'Montserrat', sans-serif", fontSize: "10px", fontWeight: "600", color: "#999999", display: "block", marginBottom: "8px", letterSpacing: "1px", textTransform: "uppercase" }}>{label}</label>
    <input 
      type="number" 
      value={value} 
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder} 
      disabled={disabled}
      onKeyDown={e => e.key === "Enter" && onSubmit && onSubmit()}
      style={{
        width: "100%", padding: "12px", borderRadius: "4px",
        border: "0.5px solid rgba(255, 255, 255, 0.2)", fontFamily: "'Montserrat', sans-serif",
        fontSize: "16px", background: disabled ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.1)", color: "#F9F9F9", textAlign: "center",
        outline: "none", transition: "border 0.3s ease"
      }} 
      onFocus={e => e.target.style.border = "0.5px solid #D4AF37"}
      onBlur={e => e.target.style.border = "0.5px solid rgba(255, 255, 255, 0.2)"}
    />
  </div>
);

const StatBox = ({ label, value, unit, subtext, highlight }) => (
  <div style={{ background: highlight ? "rgba(212, 175, 55, 0.1)" : "rgba(255, 255, 255, 0.03)", padding: "24px", borderRadius: "8px", border: highlight ? "0.5px solid rgba(212, 175, 55, 0.5)" : "0.5px solid rgba(255, 255, 255, 0.1)" }}>
    <div style={{ fontFamily: "'Montserrat', sans-serif", fontSize: "10px", letterSpacing: "1px", textTransform: "uppercase", opacity: 0.8, fontWeight: "600", color: highlight ? "#D4AF37" : "#999999" }}>{label}</div>
    <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "36px", color: highlight ? "#D4AF37" : "#F9F9F9", lineHeight: "1.2", margin: "8px 0" }}>
      {value} {unit && <span style={{ fontSize: "16px", opacity: 0.6, fontFamily: "'Montserrat', sans-serif" }}>{unit}</span>}
    </div>
    {subtext && <div style={{ fontFamily: "'Montserrat', sans-serif", fontSize: "12px", color: "#888888", marginTop: "4px" }}>{subtext}</div>}
  </div>
);

const GoldButton = ({ onClick, disabled, children, style }) => (
  <button 
    onClick={onClick} 
    disabled={disabled} 
    style={{ 
      padding: "12px 24px", 
      borderRadius: "4px", 
      border: "none", 
      background: disabled ? "rgba(255,255,255,0.1)" : "linear-gradient(135deg, #D4AF37 0%, #F1D592 50%, #CFB53B 100%)", 
      color: disabled ? "#666" : "#1A1A1A", 
      fontFamily: "'Montserrat', sans-serif",
      fontWeight: "600", 
      fontSize: "12px",
      letterSpacing: "1px",
      textTransform: "uppercase",
      cursor: disabled ? "not-allowed" : "pointer",
      transition: "opacity 0.3s ease",
      ...style 
    }}
    onMouseOver={e => !disabled && (e.target.style.opacity = 0.9)}
    onMouseOut={e => !disabled && (e.target.style.opacity = 1)}
  >
    {children}
  </button>
);

// ============================================================
// DRILL 1: 20-SHOT DISPERSION PATTERN
// ============================================================
const DispersionDrill = ({ handicap, customCarries }) => {
  const [selectedClub, setSelectedClub] = useState("7i");
  const [shots, setShots] = useState([]);
  const [carry, setCarry] = useState("");
  const [lateral, setLateral] = useState("");

  const targetDispersion = getDispersion(selectedClub, handicap);
  const targetCarry = customCarries[selectedClub] || getCarry(selectedClub, handicap);

  const addShot = () => {
    if (!carry || !lateral) return;
    setShots([...shots, { id: Date.now(), carry: parseFloat(carry), lateral: parseFloat(lateral) }]);
    setCarry(""); setLateral("");
  };

  const getStats = () => {
    if (shots.length < 4) return null;
    const sorted = [...shots];
    const byLateral = [...sorted].sort((a, b) => a.lateral - b.lateral);
    const trimmedLateral = byLateral.slice(1, -1); 
    const byCarry = [...sorted].sort((a, b) => a.carry - b.carry);
    const trimmedCarry = byCarry.slice(1, -1); 

    const laterals = trimmedLateral.map(s => s.lateral);
    const carries = trimmedCarry.map(s => s.carry);
    const lateralSpread = Math.max(...laterals) - Math.min(...laterals);
    const depthSpread = Math.max(...carries) - Math.min(...carries);
    
    const avgLateral = laterals.reduce((a, b) => a + b, 0) / laterals.length;
    const estIndex = estimateHandicap(selectedClub, lateralSpread, depthSpread);

    return {
      lateralSpread: Math.round(lateralSpread * 10) / 10,
      depthSpread: Math.round(depthSpread * 10) / 10,
      avgLateral: Math.round(avgLateral * 10) / 10,
      estIndex,
    };
  };

  const stats = getStats();

  return (
    <div style={{ padding: "20px 0" }}>
      <DrillHeader 
        title="20-Shot Dispersion Map" 
        subtitle="Full Club Profiling"
        instructions="Pick a club and set your baseline. Hit 20 shots aiming at the exact same target line. Record carry and lateral deviation. The system automatically drops your worst left/right and short/long outliers to build your true 90% expected dispersion oval." 
      />

      {/* Local Club Selector */}
      <div style={{ marginBottom: "40px" }}>
        <label style={{ fontFamily: "'Montserrat', sans-serif", fontSize: "10px", fontWeight: "600", color: "#999999", display: "block", marginBottom: "16px", letterSpacing: "1px", textTransform: "uppercase" }}>Select Club to Test</label>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          {CLUBS.map(c => (
            <button key={c} onClick={() => { setSelectedClub(c); setShots([]); }} style={{
              padding: "8px 16px", borderRadius: "4px", fontSize: "12px", fontFamily: "'Montserrat', sans-serif",
              fontWeight: selectedClub === c ? 600 : 400, border: `0.5px solid ${selectedClub === c ? "#D4AF37" : "rgba(255,255,255,0.2)"}`,
              background: selectedClub === c ? "rgba(212, 175, 55, 0.1)" : "transparent", color: selectedClub === c ? "#D4AF37" : "#CCCCCC",
              cursor: "pointer", transition: "all 0.3s ease"
            }}>{c}</button>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "40px", marginBottom: "48px" }}>
        {/* Visualizer */}
        <div style={{ flex: "1 1 300px", background: "rgba(255,255,255,0.02)", padding: "32px", borderRadius: "8px", border: "0.5px solid rgba(255,255,255,0.1)", display: "flex", flexDirection: "column", alignItems: "center" }}>
           <div style={{ marginBottom: "24px", textAlign: "center" }}>
               <strong style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "24px", color: "#F9F9F9", fontWeight: 400 }}>Target Carry: {targetCarry} yds</strong>
               <div style={{ fontFamily: "'Montserrat', sans-serif", fontSize: "12px", color: "#999999", marginTop: "8px" }}>Expected: {targetDispersion.lateral}y wide × {targetDispersion.depth}y deep</div>
           </div>
           
           {/* Scatter Plot SVG */}
           <svg width={320} height={280} style={{ display: "block" }}>
              <line x1={160} y1={20} x2={160} y2={260} stroke="rgba(255,255,255,0.2)" strokeWidth={1} strokeDasharray="4,4" />
              <line x1={20} y1={140} x2={300} y2={140} stroke="rgba(255,255,255,0.2)" strokeWidth={1} strokeDasharray="4,4" />
              
              {/* Expected Oval */}
              <ellipse cx={160} cy={140} 
                rx={(targetDispersion.lateral / 2) * (100 / (targetDispersion.lateral/2 || 1))} 
                ry={(targetDispersion.depth / 2) * (100 / (targetDispersion.depth/2 || 1))}
                fill="rgba(212, 175, 55, 0.05)" stroke="#D4AF37" strokeWidth={1} strokeDasharray="4,4" />
              
              {/* Shots */}
              {shots.map(s => {
                  const scaleLat = 100 / (targetDispersion.lateral/2);
                  const scaleDep = 100 / (targetDispersion.depth/2);
                  return (
                      <circle key={s.id} cx={160 + (s.lateral * scaleLat)} cy={140 - ((s.carry - targetCarry) * scaleDep)} r={4} fill="#F9F9F9" />
                  );
              })}
              <circle cx={160} cy={140} r={4} fill="#D4AF37" />
           </svg>
        </div>

        {/* Logger */}
        <div style={{ flex: "1 1 300px" }}>
          <div style={{ background: "rgba(255,255,255,0.02)", padding: "32px", borderRadius: "8px", border: "0.5px solid rgba(255,255,255,0.1)", marginBottom: "24px" }}>
            <h3 style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "24px", margin: "0 0 24px 0", color: "#F9F9F9", fontWeight: 400 }}>Log Shot</h3>
            <div style={{ display: "flex", gap: "16px", alignItems: "end" }}>
              <InputField label="CARRY (yds)" value={carry} onChange={setCarry} placeholder={targetCarry} onSubmit={addShot} />
              <InputField label="LATERAL (L=neg)" value={lateral} onChange={setLateral} placeholder="0" onSubmit={addShot} />
              <GoldButton onClick={addShot} style={{ height: "45px" }}>Add</GoldButton>
            </div>
          </div>

          {shots.length > 0 && (
            <div style={{ background: "rgba(255,255,255,0.02)", padding: "24px", borderRadius: "8px", border: "0.5px solid rgba(255,255,255,0.1)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "16px", alignItems: "center" }}>
                <span style={{ fontFamily: "'Montserrat', sans-serif", fontSize: "10px", fontWeight: "600", letterSpacing: "1px", color: "#999999", textTransform: "uppercase" }}>Logged Shots ({shots.length}/20)</span>
                <button onClick={() => setShots([])} style={{ background: "none", border: "none", color: "#D4AF37", fontSize: "10px", cursor: "pointer", textTransform: "uppercase", letterSpacing: "1px", fontFamily: "'Montserrat', sans-serif" }}>Clear</button>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", maxHeight: "150px", overflowY: "auto" }}>
                {shots.map((s, i) => (
                  <div key={s.id} onClick={() => setShots(shots.filter(shot => shot.id !== s.id))} style={{ padding: "6px 12px", borderRadius: "4px", fontSize: "12px", background: "rgba(255,255,255,0.05)", border: "0.5px solid rgba(255,255,255,0.1)", cursor: "pointer", color: "#CCCCCC", fontFamily: "'Montserrat', sans-serif" }}>
                    #{i+1}: {s.carry}y, {s.lateral>0?"+":""}{s.lateral}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {stats && (
        <div style={{ background: "rgba(255,255,255,0.02)", borderRadius: "8px", padding: "32px", border: "0.5px solid rgba(212, 175, 55, 0.3)" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "24px" }}>
            <StatBox highlight label="Est. Handicap" value={stats.estIndex <= 0 ? "Scratch" : stats.estIndex} subtext={`Based on ${selectedClub} spread`} />
            <StatBox label="Lateral Spread" value={stats.lateralSpread} unit="yds" subtext={`Target: ${targetDispersion.lateral}`} />
            <StatBox label="Depth Spread" value={stats.depthSpread} unit="yds" subtext={`Target: ${targetDispersion.depth}`} />
            <StatBox label="Avg Bias" value={`${stats.avgLateral > 0 ? "+" : ""}${stats.avgLateral}`} unit="yds" subtext={stats.avgLateral > 1 ? "Aim Left" : stats.avgLateral < -1 ? "Aim Right" : "Centered"} />
          </div>
        </div>
      )}
    </div>
  );
};

// ============================================================
// DRILL 2: 7-IRON COMBINE
// ============================================================
const CombineDrill = ({ handicap, customCarries }) => {
  const [shots, setShots] = useState([]);
  const [carry, setCarry] = useState("");
  const [lateral, setLateral] = useState("");
  const targetCarry = customCarries["7i"] || getCarry("7i", handicap);

  const addShot = () => {
    if (!carry || !lateral || shots.length >= 10) return;
    const cErr = parseFloat(carry) - targetCarry;
    const lErr = parseFloat(lateral);
    const proxYards = calcProximityYards(cErr, lErr);
    
    // Score logic: 100 points max per shot. Lose 3.5 points per yard off target.
    let score = Math.max(0, Math.round(100 - (proxYards * 3.5)));
    
    setShots([...shots, { id: Date.now(), carry: parseFloat(carry), lateral: lErr, score, prox: proxYards }]);
    setCarry(""); setLateral("");
  };

  const totalScore = shots.reduce((acc, s) => acc + s.score, 0);
  const avgProx = shots.length ? (shots.reduce((acc, s) => acc + s.prox, 0) / shots.length).toFixed(1) : 0;

  return (
    <div style={{ padding: "20px 0" }}>
      <DrillHeader 
        title="7-Iron Combine" 
        subtitle="Ball-Striking Benchmark"
        instructions={`The ultimate iron play test. Hit exactly 10 shots with your 7-iron aiming for your stock carry distance (${targetCarry} yds). You get a score out of 100 for each shot based on total radial proximity to the target.`} 
      />

      <div style={{ display: "flex", flexWrap: "wrap", gap: "40px" }}>
        <div style={{ flex: "1 1 300px", background: "rgba(255,255,255,0.02)", padding: "32px", borderRadius: "8px", border: "0.5px solid rgba(255,255,255,0.1)" }}>
          <h3 style={{ margin: "0 0 24px 0", fontFamily: "'Cormorant Garamond', serif", fontSize: "24px", color: "#F9F9F9", fontWeight: 400 }}>Shot {shots.length + 1} of 10</h3>
          <div style={{ display: "flex", gap: "16px", alignItems: "end", marginBottom: "32px" }}>
            <InputField label={`CARRY (${targetCarry}y)`} value={carry} onChange={setCarry} disabled={shots.length >= 10} onSubmit={addShot} />
            <InputField label="LATERAL (L=neg)" value={lateral} onChange={setLateral} disabled={shots.length >= 10} onSubmit={addShot} />
            <GoldButton onClick={addShot} disabled={shots.length >= 10} style={{ height: "45px" }}>Hit</GoldButton>
          </div>
          
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
            <div style={{ background: "rgba(255,255,255,0.03)", padding: "20px", borderRadius: "4px", textAlign: "center", border: "0.5px solid rgba(255,255,255,0.05)" }}>
              <div style={{ fontFamily: "'Montserrat', sans-serif", fontSize: "10px", color: "#999999", fontWeight: "600", letterSpacing: "1px", textTransform: "uppercase" }}>Current Score</div>
              <div style={{ fontSize: "36px", fontFamily: "'Cormorant Garamond', serif", color: "#D4AF37", marginTop: "8px" }}>{totalScore}<span style={{fontSize:"16px", color: "#666"}}>/1000</span></div>
            </div>
            <div style={{ background: "rgba(255,255,255,0.03)", padding: "20px", borderRadius: "4px", textAlign: "center", border: "0.5px solid rgba(255,255,255,0.05)" }}>
              <div style={{ fontFamily: "'Montserrat', sans-serif", fontSize: "10px", color: "#999999", fontWeight: "600", letterSpacing: "1px", textTransform: "uppercase" }}>Avg Miss</div>
              <div style={{ fontSize: "36px", fontFamily: "'Cormorant Garamond', serif", color: "#F9F9F9", marginTop: "8px" }}>{avgProx}<span style={{fontSize:"16px", color: "#666"}}>y</span></div>
            </div>
          </div>
        </div>

        <div style={{ flex: "2 1 400px" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "14px", fontFamily: "'Montserrat', sans-serif" }}>
            <thead>
              <tr style={{ borderBottom: "0.5px solid rgba(212, 175, 55, 0.3)", color: "#999999", fontSize: "11px", textTransform: "uppercase", letterSpacing: "1px" }}>
                <th style={{ textAlign: "left", padding: "12px 8px", fontWeight: 600 }}>Shot</th>
                <th style={{ textAlign: "center", padding: "12px 8px", fontWeight: 600 }}>Carry</th>
                <th style={{ textAlign: "center", padding: "12px 8px", fontWeight: 600 }}>Lateral</th>
                <th style={{ textAlign: "center", padding: "12px 8px", fontWeight: 600 }}>Proximity</th>
                <th style={{ textAlign: "right", padding: "12px 8px", fontWeight: 600 }}>Pts</th>
              </tr>
            </thead>
            <tbody>
              {shots.map((s, i) => (
                <tr key={s.id} style={{ borderBottom: "0.5px solid rgba(255,255,255,0.05)", background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.02)", color: "#CCCCCC" }}>
                  <td style={{ padding: "16px 8px" }}>{i + 1}</td>
                  <td style={{ padding: "16px 8px", textAlign: "center" }}>{s.carry}</td>
                  <td style={{ padding: "16px 8px", textAlign: "center" }}>{s.lateral > 0 ? "+" : ""}{s.lateral}</td>
                  <td style={{ padding: "16px 8px", textAlign: "center" }}>{s.prox.toFixed(1)} yds</td>
                  <td style={{ padding: "16px 8px", textAlign: "right", color: s.score > 80 ? "#D4AF37" : s.score < 40 ? "#888" : "#F9F9F9" }}>{s.score}</td>
                </tr>
              ))}
              {shots.length === 0 && (
                <tr><td colSpan="5" style={{ padding: "32px", textAlign: "center", color: "#666666", fontStyle: "italic" }}>Awaiting first shot...</td></tr>
              )}
            </tbody>
          </table>
          {shots.length > 0 && (
            <button onClick={() => setShots([])} style={{ marginTop: "24px", padding: "8px 16px", background: "none", border: "none", color: "#D4AF37", cursor: "pointer", fontSize: "12px", textTransform: "uppercase", letterSpacing: "1px", fontFamily: "'Montserrat', sans-serif" }}>Reset Combine</button>
          )}
        </div>
      </div>
    </div>
  );
};

// ============================================================
// DRILL 3: WEDGE MATRIX
// ============================================================
const WedgeMatrixDrill = () => {
  const [shots, setShots] = useState({ 50: [], 75: [], 100: [] });
  const [currentDist, setCurrentDist] = useState(50);
  const [carry, setCarry] = useState("");

  const addShot = () => {
      if (!carry || shots[currentDist].length >= 3) return;
      setShots(prev => ({ ...prev, [currentDist]: [...prev[currentDist], parseFloat(carry)] }));
      setCarry("");
  };

  const getTargetStats = (target) => {
      const data = shots[target];
      if (data.length === 0) return null;
      const errors = data.map(s => Math.abs(s - target));
      const avgError = errors.reduce((a, b) => a + b, 0) / data.length;
      return avgError.toFixed(1);
  };

  const getTotalScore = () => {
      let totalErrors = 0, totalShots = 0;
      [50, 75, 100].forEach(t => shots[t].forEach(s => { totalErrors += Math.abs(s - t); totalShots++; }));
      if (totalShots === 0) return null;
      const avgError = totalErrors / totalShots;
      
      let grade = "Needs Work";
      if (avgError <= 3.5) grade = "Tour Level";
      else if (avgError <= 5.0) grade = "Excellent";
      else if (avgError <= 8.0) grade = "Good";
      else if (avgError <= 11.0) grade = "Average";

      return { avg: avgError.toFixed(1), grade, isComplete: totalShots === 9 };
  };

  const score = getTotalScore();

  return (
      <div style={{ padding: "20px 0" }}>
          <DrillHeader 
            title="Wedge Matrix" 
            subtitle="Scoring Club Distance Control"
            instructions="Lateral misses rarely cost shots inside 100 yards; distance control is everything. Hit exactly 3 shots to each target (50, 75, 100 yards). Focus strictly on carry distance. A tour player averages ~3 yards of error across these distances." 
          />

          <div style={{ display: "flex", gap: "24px", marginBottom: "40px", flexWrap: "wrap" }}>
              {[50, 75, 100].map(dist => {
                  const isComplete = shots[dist].length === 3;
                  const avg = getTargetStats(dist);
                  return (
                      <div key={dist} onClick={() => setCurrentDist(dist)} style={{
                          flex: "1 1 200px", padding: "24px", borderRadius: "8px",
                          background: currentDist === dist ? "rgba(212, 175, 55, 0.1)" : "rgba(255,255,255,0.02)",
                          border: `0.5px solid ${currentDist === dist ? "#D4AF37" : "rgba(255,255,255,0.1)"}`,
                          cursor: "pointer", transition: "all 0.3s ease"
                      }}>
                          <div style={{ fontSize: "32px", fontFamily: "'Cormorant Garamond', serif", color: currentDist === dist ? "#D4AF37" : "#F9F9F9", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                              {dist} yds {isComplete && <span style={{ color: "#D4AF37", fontSize: "20px" }}>✓</span>}
                          </div>
                          <div style={{ fontFamily: "'Montserrat', sans-serif", fontSize: "12px", color: "#999999", marginTop: "12px", textTransform: "uppercase", letterSpacing: "1px" }}>{shots[dist].length}/3 shots logged</div>
                          {avg && <div style={{ marginTop: "16px", fontFamily: "'Montserrat', sans-serif", fontSize: "14px", color: currentDist === dist ? "#D4AF37" : "#CCCCCC" }}>Avg Error: {avg}y</div>}
                      </div>
                  );
              })}
          </div>

          <div style={{ background: "rgba(255,255,255,0.02)", padding: "32px", borderRadius: "8px", border: "0.5px solid rgba(255,255,255,0.1)", display: "flex", alignItems: "center", gap: "32px", flexWrap: "wrap" }}>
              <div style={{ flex: "0 0 200px" }}>
                  <InputField label={`Log Shot for ${currentDist} yds`} value={carry} onChange={setCarry} disabled={shots[currentDist].length >= 3} placeholder="Carry Yds" onSubmit={addShot} />
                  <GoldButton onClick={addShot} disabled={shots[currentDist].length >= 3} style={{ marginTop: "16px", width: "100%" }}>Add</GoldButton>
              </div>
              <div style={{ flex: 1, display: "flex", gap: "16px", flexWrap: "wrap" }}>
                  {shots[currentDist].map((s, i) => (
                      <div key={i} style={{ padding: "16px 24px", background: "rgba(255,255,255,0.05)", border: "0.5px solid rgba(255,255,255,0.1)", borderRadius: "4px", fontSize: "16px", fontFamily: "'Montserrat', sans-serif", color: "#F9F9F9" }}>
                          Shot {i+1}: {s}y <span style={{ color: "#999", fontSize: "14px", marginLeft: "8px" }}>({Math.abs(s - currentDist)}y off)</span>
                      </div>
                  ))}
                  {shots[currentDist].length === 0 && <div style={{ color: "#666", fontStyle: "italic", padding: "16px", fontFamily: "'Montserrat', sans-serif", fontSize: "14px" }}>Enter carry distance...</div>}
              </div>
          </div>

          {score && score.isComplete && (
              <div style={{ marginTop: "40px", padding: "40px", borderRadius: "8px", background: "rgba(212, 175, 55, 0.05)", border: "0.5px solid rgba(212, 175, 55, 0.3)", textAlign: "center" }}>
                  <div style={{ fontFamily: "'Montserrat', sans-serif", fontSize: "12px", color: "#D4AF37", letterSpacing: "2px", textTransform: "uppercase", marginBottom: "16px" }}>Overall Matrix Grade</div>
                  <div style={{ fontSize: "64px", fontFamily: "'Cormorant Garamond', serif", color: "#F9F9F9", margin: "0 0 16px 0", lineHeight: 1 }}>{score.avg} <span style={{fontSize:"24px", color:"#999"}}>yds avg error</span></div>
                  <div style={{ fontFamily: "'Montserrat', sans-serif", fontSize: "20px", color: "#CCCCCC", letterSpacing: "1px" }}>Result: <span style={{ color: "#D4AF37" }}>{score.grade}</span></div>
                  <button onClick={() => setShots({50:[], 75:[], 100:[]})} style={{ marginTop: "32px", padding: "12px 32px", background: "transparent", border: "0.5px solid rgba(255,255,255,0.2)", color: "#F9F9F9", borderRadius: "4px", cursor: "pointer", fontFamily: "'Montserrat', sans-serif", fontSize: "12px", textTransform: "uppercase", letterSpacing: "1px", transition: "all 0.3s ease" }} onMouseOver={e => e.target.style.background = "rgba(255,255,255,0.05)"} onMouseOut={e => e.target.style.background = "transparent"}>Start Over</button>
              </div>
          )}
      </div>
  );
};

// ============================================================
// DRILL 4: UP & DOWN SCRAMBLE
// ============================================================
const ScrambleDrill = () => {
  const [shots, setShots] = useState([]);
  const [feet, setFeet] = useState("");

  // Est Tour Make % based on distance
  const getExpectedMake = (ft) => {
    if (ft <= 3) return 95;
    if (ft <= 5) return 75;
    if (ft <= 8) return 50;
    if (ft <= 10) return 40;
    if (ft <= 15) return 30;
    if (ft <= 20) return 15;
    return 5;
  };

  const addShot = () => {
    if (!feet || shots.length >= 10) return;
    const prox = parseFloat(feet);
    setShots([...shots, { id: Date.now(), prox, expMake: getExpectedMake(prox) }]);
    setFeet("");
  };

  const avgMake = shots.length ? (shots.reduce((acc, s) => acc + s.expMake, 0) / shots.length) : 0;
  
  return (
    <div style={{ padding: "20px 0" }}>
      <DrillHeader 
        title="Up & Down Scramble" 
        subtitle="Short Game Proximity"
        instructions="Take 10 balls and drop them in various difficult lies around the practice green (rough, bunkers, tight lies). Chip/pitch to the hole. Measure your final proximity to the hole in FEET. The app calculates your expected scramble percentage based on Tour average putting stats from that distance." 
      />

      <div style={{ display: "flex", flexWrap: "wrap", gap: "40px" }}>
        <div style={{ flex: "1 1 250px", background: "rgba(255,255,255,0.02)", padding: "32px", borderRadius: "8px", border: "0.5px solid rgba(255,255,255,0.1)", height: "fit-content" }}>
          <InputField label="Proximity (Feet)" value={feet} onChange={setFeet} disabled={shots.length >= 10} placeholder="e.g. 6.5" onSubmit={addShot} />
          <GoldButton onClick={addShot} disabled={shots.length >= 10} style={{ marginTop: "24px", width: "100%" }}>Log Chip</GoldButton>
          
          {shots.length > 0 && (
             <div style={{ marginTop: "40px", background: "rgba(212, 175, 55, 0.05)", padding: "24px", borderRadius: "4px", border: "0.5px solid rgba(212, 175, 55, 0.3)", textAlign: "center" }}>
                <div style={{ fontFamily: "'Montserrat', sans-serif", fontSize: "10px", color: "#D4AF37", fontWeight: "600", letterSpacing: "1px", textTransform: "uppercase" }}>Expected Scramble %</div>
                <div style={{ fontSize: "48px", fontFamily: "'Cormorant Garamond', serif", color: "#F9F9F9", margin: "16px 0" }}>{avgMake.toFixed(1)}%</div>
                <button onClick={() => setShots([])} style={{ background: "none", border: "none", color: "#999", fontSize: "10px", textTransform: "uppercase", letterSpacing: "1px", cursor: "pointer", fontFamily: "'Montserrat', sans-serif" }}>Reset Game</button>
             </div>
          )}
        </div>

        <div style={{ flex: "2 1 400px" }}>
           <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: "16px" }}>
              {shots.map((s, i) => (
                 <div key={s.id} style={{ background: "rgba(255,255,255,0.03)", border: "0.5px solid rgba(255,255,255,0.1)", borderRadius: "4px", padding: "20px", textAlign: "center" }}>
                    <div style={{ fontFamily: "'Montserrat', sans-serif", fontSize: "10px", color: "#999999", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "1px" }}>Chip {i+1}</div>
                    <div style={{ fontSize: "24px", fontFamily: "'Cormorant Garamond', serif", color: "#F9F9F9" }}>{s.prox} ft</div>
                    <div style={{ fontFamily: "'Montserrat', sans-serif", fontSize: "12px", color: s.expMake > 50 ? "#D4AF37" : "#888", marginTop: "8px" }}>{s.expMake}% make prob</div>
                 </div>
              ))}
              {Array.from({ length: 10 - shots.length }).map((_, i) => (
                 <div key={`empty-${i}`} style={{ background: "transparent", border: "0.5px dashed rgba(255,255,255,0.2)", borderRadius: "4px", padding: "20px", display: "flex", alignItems: "center", justifyContent: "center", height: "100px" }}>
                    <span style={{ color: "#666", fontSize: "12px", fontFamily: "'Montserrat', sans-serif", textTransform: "uppercase", letterSpacing: "1px" }}>Shot {shots.length + i + 1}</span>
                 </div>
              ))}
           </div>
        </div>
      </div>
    </div>
  );
};

// ============================================================
// DRILL 5: THE BIG 3 IMPACT LOGGER (ADAM YOUNG)
// ============================================================
const ImpactDrill = ({ saveSession }) => {
  const [shots, setShots] = useState([]);
  const [mode, setMode] = useState("feel"); // "feel" or "sim"
  
  // Feel Mode State
  const [strike, setStrike] = useState("");
  const [lowPoint, setLowPoint] = useState("");
  const [face, setFace] = useState("");

  // Sim Mode State
  const [faceAngle, setFaceAngle] = useState("");
  const [clubPath, setClubPath] = useState("");
  const [impactLoc, setImpactLoc] = useState(""); // mm from center

  const addFeelShot = () => {
    if (!strike || !lowPoint || !face || shots.length >= 10) return;
    setShots([...shots, { id: Date.now(), type: "feel", strike, lowPoint, face }]);
    setStrike(""); setLowPoint(""); setFace("");
  };

  const addSimShot = () => {
    if (!faceAngle || !clubPath || !impactLoc || shots.length >= 10) return;
    const f2p = parseFloat(faceAngle) - parseFloat(clubPath);
    setShots([...shots, { 
      id: Date.now(), 
      type: "sim", 
      faceAngle: parseFloat(faceAngle), 
      clubPath: parseFloat(clubPath), 
      faceToPath: f2p,
      impactLoc: parseFloat(impactLoc) 
    }]);
    setFaceAngle(""); setClubPath(""); setImpactLoc("");
  };

  const getPercentage = (key, value) => {
    if (shots.length === 0) return 0;
    return Math.round((shots.filter(s => s[key] === value).length / shots.length) * 100);
  };

  const getSimAvg = (key) => {
    const simShots = shots.filter(s => s.type === "sim");
    if (simShots.length === 0) return 0;
    return (simShots.reduce((acc, s) => acc + s[key], 0) / simShots.length).toFixed(1);
  };

  const handleSave = () => {
    saveSession("Big 3 Impact", {
      mode,
      shotsLogged: shots.length,
      feelStats: mode === "feel" ? {
        centeredStrike: getPercentage('strike', 'Center'),
        pureLowPoint: getPercentage('lowPoint', 'Pure'),
        squareFace: getPercentage('face', 'Square')
      } : null,
      simStats: mode === "sim" ? {
        avgFaceAngle: getSimAvg('faceAngle'),
        avgClubPath: getSimAvg('clubPath'),
        avgFaceToPath: getSimAvg('faceToPath'),
        avgImpactLoc: getSimAvg('impactLoc')
      } : null
    });
    setShots([]);
  };

  const SelectionGroup = ({ label, options, value, onChange }) => (
    <div style={{ marginBottom: "24px" }}>
      <label style={{ fontFamily: "'Montserrat', sans-serif", fontSize: "10px", fontWeight: "600", color: "#999999", display: "block", marginBottom: "12px", letterSpacing: "1px", textTransform: "uppercase" }}>{label}</label>
      <div style={{ display: "flex", gap: "8px" }}>
        {options.map(opt => (
          <button key={opt} onClick={() => onChange(opt)} style={{
            flex: 1, padding: "12px", borderRadius: "4px", fontSize: "12px", fontFamily: "'Montserrat', sans-serif",
            fontWeight: value === opt ? 600 : 400, border: `0.5px solid ${value === opt ? "#D4AF37" : "rgba(255,255,255,0.2)"}`,
            background: value === opt ? "rgba(212, 175, 55, 0.1)" : "transparent", color: value === opt ? "#D4AF37" : "#CCCCCC",
            cursor: "pointer", transition: "all 0.3s ease"
          }}>{opt}</button>
        ))}
      </div>
    </div>
  );

  return (
    <div style={{ padding: "20px 0" }}>
      <DrillHeader 
        title="The Big 3 Impact Logger" 
        subtitle="Adam Young's Ball Flight Laws"
        instructions="Golf is about managing the Big 3: Face Contact (Strike), Ground Contact (Low Point), and Face Angle (Direction). Log your perceived impact (Feel) or exact launch monitor data (Sim)." 
      />
      
      <div style={{ display: "flex", gap: "16px", marginBottom: "32px" }}>
        <button onClick={() => { setMode("feel"); setShots([]); }} style={{ padding: "8px 24px", borderRadius: "4px", border: mode === "feel" ? "0.5px solid #D4AF37" : "0.5px solid rgba(255,255,255,0.2)", background: mode === "feel" ? "rgba(212, 175, 55, 0.1)" : "transparent", color: mode === "feel" ? "#D4AF37" : "#999", fontFamily: "'Montserrat', sans-serif", fontSize: "12px", textTransform: "uppercase", letterSpacing: "1px", cursor: "pointer" }}>Feel Mode (Course)</button>
        <button onClick={() => { setMode("sim"); setShots([]); }} style={{ padding: "8px 24px", borderRadius: "4px", border: mode === "sim" ? "0.5px solid #D4AF37" : "0.5px solid rgba(255,255,255,0.2)", background: mode === "sim" ? "rgba(212, 175, 55, 0.1)" : "transparent", color: mode === "sim" ? "#D4AF37" : "#999", fontFamily: "'Montserrat', sans-serif", fontSize: "12px", textTransform: "uppercase", letterSpacing: "1px", cursor: "pointer" }}>Sim Mode (Uneekor/Trackman)</button>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "40px" }}>
        <div style={{ flex: "1 1 300px", background: "rgba(255,255,255,0.02)", padding: "32px", borderRadius: "8px", border: "0.5px solid rgba(255,255,255,0.1)" }}>
          <h3 style={{ margin: "0 0 24px 0", fontFamily: "'Cormorant Garamond', serif", fontSize: "24px", color: "#F9F9F9", fontWeight: 400 }}>Shot {shots.length + 1} of 10</h3>
          
          {mode === "feel" ? (
            <>
              <SelectionGroup label="1. Face Contact (Strike)" options={["Toe", "Center", "Heel"]} value={strike} onChange={setStrike} />
              <SelectionGroup label="2. Ground Contact (Low Point)" options={["Fat", "Pure", "Thin"]} value={lowPoint} onChange={setLowPoint} />
              <SelectionGroup label="3. Face Angle (Direction)" options={["Open (Right)", "Square", "Closed (Left)"]} value={face} onChange={setFace} />
              <GoldButton onClick={addFeelShot} disabled={!strike || !lowPoint || !face || shots.length >= 10} style={{ width: "100%", marginTop: "8px" }}>Log Impact</GoldButton>
            </>
          ) : (
            <>
              <div style={{ display: "flex", gap: "16px", marginBottom: "16px" }}>
                <InputField label="Face Angle (°)" value={faceAngle} onChange={setFaceAngle} placeholder="e.g. 2.1" onSubmit={addSimShot} />
                <InputField label="Club Path (°)" value={clubPath} onChange={setClubPath} placeholder="e.g. -1.5" onSubmit={addSimShot} />
              </div>
              <div style={{ marginBottom: "24px" }}>
                <InputField label="Impact Loc (mm from center)" value={impactLoc} onChange={setImpactLoc} placeholder="e.g. 5 (Toe)" onSubmit={addSimShot} />
              </div>
              <GoldButton onClick={addSimShot} disabled={!faceAngle || !clubPath || !impactLoc || shots.length >= 10} style={{ width: "100%" }}>Log Sim Data</GoldButton>
            </>
          )}
        </div>
        <div style={{ flex: "1 1 300px" }}>
          {mode === "feel" ? (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "24px" }}>
              <StatBox highlight label="Centered Strike" value={`${getPercentage('strike', 'Center')}%`} />
              <StatBox highlight label="Pure Low Point" value={`${getPercentage('lowPoint', 'Pure')}%`} />
              <StatBox highlight label="Square Face" value={`${getPercentage('face', 'Square')}%`} />
              <StatBox label="Total Logged" value={`${shots.length}/10`} />
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "24px" }}>
              <StatBox highlight label="Avg Face-to-Path" value={`${getSimAvg('faceToPath')}°`} subtext="Closer to 0 = Straighter" />
              <StatBox highlight label="Avg Impact Loc" value={`${getSimAvg('impactLoc')}mm`} subtext="Closer to 0 = Center" />
              <StatBox label="Avg Face Angle" value={`${getSimAvg('faceAngle')}°`} />
              <StatBox label="Avg Club Path" value={`${getSimAvg('clubPath')}°`} />
            </div>
          )}
          
          <div style={{ display: "flex", gap: "16px" }}>
            {shots.length > 0 && (
              <button onClick={() => setShots([])} style={{ padding: "8px 16px", background: "none", border: "none", color: "#999", cursor: "pointer", fontSize: "10px", textTransform: "uppercase", letterSpacing: "1px", fontFamily: "'Montserrat', sans-serif" }}>Reset Logger</button>
            )}
            {shots.length === 10 && (
              <GoldButton onClick={handleSave}>Save Session</GoldButton>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// ============================================================
// DRILL 6: DECADE TIGER 5 SCORECARD
// ============================================================
const DecadeDrill = ({ saveSession }) => {
  const [stats, setStats] = useState({
    par5Bogeys: 0,
    doubleBogeys: 0,
    threePutts: 0,
    scoringBogeys: 0,
    blownSaves: 0
  });

  const updateStat = (key, delta) => {
    setStats(prev => ({ ...prev, [key]: Math.max(0, prev[key] + delta) }));
  };

  const handleSave = () => {
    saveSession("DECADE Tiger 5", {
      totalMistakes,
      breakdown: stats
    });
    setStats({par5Bogeys: 0, doubleBogeys: 0, threePutts: 0, scoringBogeys: 0, blownSaves: 0});
  };

  const totalMistakes = Object.values(stats).reduce((a, b) => a + b, 0);
  
  const StatCounter = ({ label, desc, statKey }) => (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 0", borderBottom: "0.5px solid rgba(255,255,255,0.05)" }}>
      <div>
        <div style={{ fontFamily: "'Montserrat', sans-serif", fontSize: "14px", color: "#F9F9F9", fontWeight: 600 }}>{label}</div>
        <div style={{ fontFamily: "'Montserrat', sans-serif", fontSize: "11px", color: "#999999", marginTop: "4px" }}>{desc}</div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
        <button onClick={() => updateStat(statKey, -1)} style={{ width: "32px", height: "32px", borderRadius: "50%", background: "rgba(255,255,255,0.05)", border: "0.5px solid rgba(255,255,255,0.2)", color: "#F9F9F9", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>-</button>
        <span style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "24px", color: "#D4AF37", width: "24px", textAlign: "center" }}>{stats[statKey]}</span>
        <button onClick={() => updateStat(statKey, 1)} style={{ width: "32px", height: "32px", borderRadius: "50%", background: "rgba(255,255,255,0.05)", border: "0.5px solid rgba(255,255,255,0.2)", color: "#F9F9F9", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>+</button>
      </div>
    </div>
  );

  return (
    <div style={{ padding: "20px 0" }}>
      <DrillHeader 
        title="DECADE Tiger 5" 
        subtitle="Scott Fawcett's Scoring Matrix"
        instructions="The DECADE system emphasizes avoiding catastrophic errors over making birdies. Tiger Woods' dominance was built on the 'Tiger 5'. Track these 5 fatal errors during your next round. A scratch player averages 3 or fewer per round." 
      />
      <div style={{ display: "flex", flexWrap: "wrap", gap: "40px" }}>
        <div style={{ flex: "2 1 400px", background: "rgba(255,255,255,0.02)", padding: "32px", borderRadius: "8px", border: "0.5px solid rgba(255,255,255,0.1)" }}>
          <StatCounter label="Par 5 Bogeys" desc="Bogeys or worse on any Par 5" statKey="par5Bogeys" />
          <StatCounter label="Double Bogeys" desc="Any score of Double Bogey or worse" statKey="doubleBogeys" />
          <StatCounter label="3-Putts" desc="Taking 3 or more putts on a green" statKey="threePutts" />
          <StatCounter label="Scoring Club Bogeys" desc="Bogeys when having a 9-iron or less into the green" statKey="scoringBogeys" />
          <StatCounter label="Blown Saves" desc="Failing to get up-and-down from inside 10 yards with a good lie" statKey="blownSaves" />
        </div>
        <div style={{ flex: "1 1 250px" }}>
          <div style={{ background: "rgba(212, 175, 55, 0.05)", padding: "32px", borderRadius: "8px", border: "0.5px solid rgba(212, 175, 55, 0.3)", textAlign: "center", marginBottom: "24px" }}>
            <div style={{ fontFamily: "'Montserrat', sans-serif", fontSize: "10px", color: "#D4AF37", fontWeight: "600", letterSpacing: "1px", textTransform: "uppercase" }}>Total Tiger 5 Errors</div>
            <div style={{ fontSize: "64px", fontFamily: "'Cormorant Garamond', serif", color: "#F9F9F9", margin: "16px 0" }}>{totalMistakes}</div>
            <div style={{ fontFamily: "'Montserrat', sans-serif", fontSize: "12px", color: totalMistakes <= 3 ? "#D4AF37" : "#999999" }}>
              {totalMistakes === 0 ? "Flawless Round" : totalMistakes <= 3 ? "Tour Level Discipline" : totalMistakes <= 6 ? "Good Amateur Round" : "Too Many Unforced Errors"}
            </div>
          </div>
          <div style={{ display: "flex", gap: "16px" }}>
            <button onClick={() => setStats({par5Bogeys: 0, doubleBogeys: 0, threePutts: 0, scoringBogeys: 0, blownSaves: 0})} style={{ flex: 1, padding: "12px", background: "transparent", border: "0.5px solid rgba(255,255,255,0.2)", color: "#F9F9F9", borderRadius: "4px", cursor: "pointer", fontFamily: "'Montserrat', sans-serif", fontSize: "10px", textTransform: "uppercase", letterSpacing: "1px" }}>Reset</button>
            <GoldButton onClick={handleSave} style={{ flex: 2 }}>Save Round</GoldButton>
          </div>
        </div>
      </div>
    </div>
  );
};

// ============================================================
// DATA VIEW: MODEL TARGETS
// ============================================================
const TargetTables = ({ handicap, customCarries, setCustomCarries }) => (
  <div style={{ padding: "20px 0" }}>
    <DrillHeader 
      title="Bag Setup & Targets" 
      subtitle="Expected dispersion by club"
      instructions={`These are the expected spread dimensions for a ${handicap} handicap based on 10,000+ swings. Lateral is total left-to-right spread. Depth is total short-to-long spread. Expect 90% of your shots to fall within these windows. You can override your target carry distances below.`} 
    />
    <div style={{ background: "rgba(255,255,255,0.02)", borderRadius: "8px", border: "0.5px solid rgba(255,255,255,0.1)", overflow: "hidden" }}>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "14px", fontFamily: "'Montserrat', sans-serif" }}>
          <thead>
            <tr style={{ background: "rgba(255,255,255,0.05)", color: "#999999", fontSize: "11px", textTransform: "uppercase", letterSpacing: "1px" }}>
              <th style={{ padding: "16px 24px", textAlign: "left", fontWeight: 600 }}>Club</th>
              <th style={{ padding: "16px 24px", textAlign: "center", fontWeight: 600 }}>Target Carry</th>
              <th style={{ padding: "16px 24px", textAlign: "center", fontWeight: 600 }}>Total Width</th>
              <th style={{ padding: "16px 24px", textAlign: "center", fontWeight: 600 }}>Total Depth</th>
              <th style={{ padding: "16px 24px", textAlign: "center", fontWeight: 600 }}>L/R Aim ±</th>
            </tr>
          </thead>
          <tbody>
            {CLUBS.map((c, i) => {
              const d = getDispersion(c, handicap);
              const defaultCarry = getCarry(c, handicap);
              const isCustom = !!customCarries[c];
              const displayCarry = customCarries[c] || defaultCarry;

              return (
                <tr key={c} style={{ background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.02)", borderBottom: "0.5px solid rgba(255,255,255,0.05)" }}>
                  <td style={{ padding: "16px 24px", fontWeight: "600", color: "#F9F9F9" }}>{c}</td>
                  <td style={{ padding: "16px 24px", textAlign: "center", color: "#CCCCCC" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}>
                      <input 
                        type="number" 
                        value={displayCarry}
                        onChange={(e) => {
                          const val = parseInt(e.target.value);
                          if (isNaN(val)) {
                            const newCarries = {...customCarries};
                            delete newCarries[c];
                            setCustomCarries(newCarries);
                          } else {
                            setCustomCarries({...customCarries, [c]: val});
                          }
                        }}
                        style={{
                          width: "70px", padding: "8px", borderRadius: "4px",
                          border: isCustom ? "0.5px solid #D4AF37" : "0.5px solid rgba(255,255,255,0.2)", 
                          background: isCustom ? "rgba(212, 175, 55, 0.1)" : "rgba(255,255,255,0.05)",
                          color: isCustom ? "#D4AF37" : "#F9F9F9",
                          textAlign: "center", fontFamily: "'Montserrat', sans-serif",
                          outline: "none", transition: "all 0.3s ease"
                        }}
                      />
                      <span style={{ fontSize: "12px", color: "#666" }}>yds</span>
                      {isCustom && (
                        <button 
                          onClick={() => {
                            const newCarries = {...customCarries};
                            delete newCarries[c];
                            setCustomCarries(newCarries);
                          }}
                          style={{ background: "none", border: "none", color: "#999", cursor: "pointer", fontSize: "10px", textTransform: "uppercase", letterSpacing: "1px", marginLeft: "8px" }}
                          title="Reset to default"
                        >
                          Reset
                        </button>
                      )}
                    </div>
                  </td>
                  <td style={{ padding: "16px 24px", textAlign: "center", color: "#F9F9F9" }}>{d.lateral}y</td>
                  <td style={{ padding: "16px 24px", textAlign: "center", color: "#F9F9F9" }}>{d.depth}y</td>
                  <td style={{ padding: "16px 24px", textAlign: "center", color: "#999999" }}>±{Math.round(d.lateral / 2)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  </div>
);

// ============================================================
// AI COACH VIEW
// ============================================================
const AICoachView = ({ history, handicap, saveSession }) => {
  const [analysis, setAnalysis] = useState("");
  const [loading, setLoading] = useState(false);
  
  const [uploadFile, setUploadFile] = useState(null);
  const [uploadComment, setUploadComment] = useState("");
  const [isUploading, setIsUploading] = useState(false);

  const handleUpload = async () => {
    if (!uploadFile) return;
    setIsUploading(true);
    try {
      const reader = new FileReader();
      reader.readAsDataURL(uploadFile);
      reader.onloadend = async () => {
        const base64Data = reader.result.split(',')[1];
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        const prompt = `
          You are a golf data extraction assistant.
          Analyze the provided image (which could be a launch monitor screen like Trackman/Uneekor, a scorecard, or drill results) and the user's comment: "${uploadComment}".
          
          Determine the best drill category for this data from the following options:
          - "Big 3 Impact" (if it shows face angle, club path, impact location)
          - "7-Iron Combine" (if it shows carry distances and lateral misses for irons)
          - "Wedge Matrix" (if it shows wedge distances)
          - "DECADE Tiger 5" (if it shows scorecard mistakes)
          - "General Sim Session" (if it's just general launch monitor data)

          Extract the relevant averages or totals.
          Return ONLY a valid JSON object with this exact structure:
          {
            "drillName": "Name of the drill",
            "data": {
              "summary": "A brief 1-sentence summary of what was extracted.",
              "extractedStats": { "Stat Name": "Value", "Another Stat": "Value" }
            }
          }
          Do not include markdown formatting like \`\`\`json.
        `;

        const response = await ai.models.generateContent({
          model: "gemini-3.1-flash-image-preview",
          contents: {
            parts: [
              { text: prompt },
              { inlineData: { data: base64Data, mimeType: uploadFile.type } }
            ]
          }
        });

        try {
          let jsonStr = response.text.trim();
          if (jsonStr.startsWith('\`\`\`json')) jsonStr = jsonStr.replace(/\`\`\`json/g, '');
          if (jsonStr.startsWith('\`\`\`')) jsonStr = jsonStr.replace(/\`\`\`/g, '');
          jsonStr = jsonStr.trim();
          
          const parsedData = JSON.parse(jsonStr);
          saveSession(parsedData.drillName || "General Sim Session", parsedData.data);
          
          setUploadFile(null);
          setUploadComment("");
        } catch (e) {
          console.error(e);
          alert("Could not parse the data. Please try again.");
        }
        setIsUploading(false);
      };
    } catch (error) {
      console.error(error);
      alert("Error processing image.");
      setIsUploading(false);
    }
  };

  const getAIAdvice = async () => {
    if (history.length === 0) return;
    setLoading(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const prompt = `
        You are an elite golf instructor analyzing a student's practice history.
        The student is a ${handicap} handicap.
        Here is their recent practice log data (JSON format):
        ${JSON.stringify(history)}
        
        Provide a concise, highly analytical summary of their patterns.
        Identify their biggest weakness based on the data.
        Recommend ONE specific drill or focus area for their next session.
        Keep the tone professional, direct, and encouraging (Quiet Luxury aesthetic).
        Format with markdown.
      `;
      
      const response = await ai.models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents: prompt,
      });
      
      setAnalysis(response.text);
    } catch (error) {
      console.error(error);
      setAnalysis("Unable to connect to AI Coach at this time. Please ensure your Gemini API key is configured.");
    }
    setLoading(false);
  };

  return (
    <div style={{ padding: "20px 0" }}>
      <DrillHeader 
        title="AI Practice Coach" 
        subtitle="Powered by Gemini 3.1 Pro"
        instructions="Analyze your saved practice sessions to identify patterns and receive personalized recommendations for your next range session." 
      />
      
      <div style={{ display: "flex", flexWrap: "wrap", gap: "40px" }}>
        <div style={{ flex: "1 1 300px" }}>
          <h3 style={{ margin: "0 0 24px 0", fontFamily: "'Cormorant Garamond', serif", fontSize: "24px", color: "#F9F9F9", fontWeight: 400 }}>Session History</h3>
          {history.length === 0 ? (
            <div style={{ padding: "32px", background: "rgba(255,255,255,0.02)", border: "0.5px solid rgba(255,255,255,0.1)", borderRadius: "8px", color: "#999", fontStyle: "italic", textAlign: "center" }}>
              No sessions saved yet. Complete a drill and click "Save Session" to build your history.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "12px", maxHeight: "400px", overflowY: "auto" }}>
              {history.slice().reverse().map(session => (
                <div key={session.id} style={{ padding: "16px", background: "rgba(255,255,255,0.02)", border: "0.5px solid rgba(255,255,255,0.1)", borderRadius: "4px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
                    <strong style={{ color: "#D4AF37", fontFamily: "'Montserrat', sans-serif", fontSize: "12px", textTransform: "uppercase", letterSpacing: "1px" }}>{session.drill}</strong>
                    <span style={{ color: "#666", fontSize: "12px" }}>{new Date(session.date).toLocaleDateString()}</span>
                  </div>
                  <div style={{ fontSize: "12px", color: "#CCCCCC", fontFamily: "'Montserrat', sans-serif" }}>
                    {session.drill === "7-Iron Combine" && session.data.score && `Score: ${session.data.score}/1000 | Avg Miss: ${session.data.avgProx}y`}
                    {session.drill === "Wedge Matrix" && session.data.grade && `Grade: ${session.data.grade} | Avg Error: ${session.data.avgError}y`}
                    {session.drill === "Scramble Test" && session.data.scramblePercent && `Expected Scramble: ${session.data.scramblePercent}%`}
                    {session.drill === "Big 3 Impact" && session.data.mode === "feel" && `Centered: ${session.data.feelStats.centeredStrike}%`}
                    {session.drill === "Big 3 Impact" && session.data.mode === "sim" && `Avg Face-to-Path: ${session.data.simStats.avgFaceToPath}°`}
                    {session.drill === "DECADE Tiger 5" && session.data.totalMistakes !== undefined && `Total Errors: ${session.data.totalMistakes}`}
                    {session.data.summary && <div>{session.data.summary}</div>}
                    {session.data.extractedStats && <div>{Object.entries(session.data.extractedStats).map(([k, v]) => `${k}: ${v}`).join(' | ')}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        
        <div style={{ flex: "2 1 400px" }}>
          <div style={{ background: "rgba(255,255,255,0.02)", padding: "32px", borderRadius: "8px", border: "0.5px solid rgba(255,255,255,0.1)", marginBottom: "24px" }}>
            <h3 style={{ margin: "0 0 16px 0", fontFamily: "'Cormorant Garamond', serif", fontSize: "24px", color: "#D4AF37", fontWeight: 400 }}>Smart Data Import</h3>
            <p style={{ fontFamily: "'Montserrat', sans-serif", fontSize: "12px", color: "#999", marginBottom: "16px", lineHeight: "1.6" }}>Upload a photo of your Uneekor, Trackman, or scorecard. Add context, and Gemini will automatically extract and log the session.</p>
            
            <div>
              <input 
                type="file" 
                id="smart-upload"
                accept="image/*" 
                onChange={e => setUploadFile(e.target.files[0])} 
                style={{ display: "none" }} 
              />
              <label htmlFor="smart-upload" style={{ 
                display: "inline-block",
                padding: "12px 24px", 
                background: uploadFile ? "rgba(212, 175, 55, 0.2)" : "rgba(255, 255, 255, 0.05)", 
                border: uploadFile ? "0.5px solid #D4AF37" : "0.5px solid rgba(255, 255, 255, 0.2)", 
                color: uploadFile ? "#D4AF37" : "#F9F9F9", 
                borderRadius: "4px", 
                cursor: "pointer",
                fontFamily: "'Montserrat', sans-serif", 
                fontSize: "12px", 
                textTransform: "uppercase", 
                letterSpacing: "1px",
                marginBottom: "16px",
                width: "100%",
                textAlign: "center",
                boxSizing: "border-box",
                transition: "all 0.3s ease"
              }}>
                {uploadFile ? `📷 ${uploadFile.name}` : "📷 Select Photo to Upload"}
              </label>
            </div>
            
            <textarea 
              placeholder="Add context (e.g., 'Working on hitting draws with my 7-iron')"
              value={uploadComment}
              onChange={e => setUploadComment(e.target.value)}
              style={{
                width: "100%", padding: "12px", borderRadius: "4px",
                border: "0.5px solid rgba(255, 255, 255, 0.2)", fontFamily: "'Montserrat', sans-serif",
                fontSize: "12px", background: "rgba(255,255,255,0.05)", color: "#F9F9F9",
                outline: "none", minHeight: "80px", marginBottom: "16px", resize: "vertical"
              }}
            />
            
            <GoldButton onClick={handleUpload} disabled={!uploadFile || isUploading} style={{ width: "100%" }}>
              {isUploading ? "Extracting Data..." : "Process & Save Session"}
            </GoldButton>
          </div>

          <div style={{ background: "rgba(212, 175, 55, 0.05)", padding: "32px", borderRadius: "8px", border: "0.5px solid rgba(212, 175, 55, 0.3)", minHeight: "300px", display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
              <h3 style={{ margin: 0, fontFamily: "'Cormorant Garamond', serif", fontSize: "24px", color: "#D4AF37", fontWeight: 400 }}>Coach Analysis</h3>
              <GoldButton onClick={getAIAdvice} disabled={history.length === 0 || loading}>
                {loading ? "Analyzing..." : "Generate Insights"}
              </GoldButton>
            </div>
            
            <div className="markdown-body" style={{ color: "#F9F9F9", fontFamily: "'Montserrat', sans-serif", fontSize: "14px", lineHeight: "1.8", flex: 1 }}>
              {analysis ? (
                <Markdown>{analysis}</Markdown>
              ) : (
                <div style={{ color: "#666", fontStyle: "italic", textAlign: "center", marginTop: "40px" }}>
                  {history.length > 0 ? "Click 'Generate Insights' to have Gemini analyze your practice history." : "Complete and save drills to unlock AI analysis."}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ============================================================
// MAIN APP SHELL
// ============================================================
export default function App() {
  const [handicap, setHandicap] = useState(10);
  const [activeTab, setActiveTab] = useState("dispersion");
  const [customCarries, setCustomCarries] = useState({});
  const [history, setHistory] = useState([]);

  // Load history on mount
  useEffect(() => {
    const saved = localStorage.getItem("golf_dispersion_history");
    if (saved) {
      try {
        setHistory(JSON.parse(saved));
      } catch (e) {
        console.error("Failed to parse history", e);
      }
    }
  }, []);

  const saveSession = (drillName, data) => {
    const newSession = {
      id: Date.now(),
      date: new Date().toISOString(),
      drill: drillName,
      data
    };
    const newHistory = [...history, newSession];
    setHistory(newHistory);
    localStorage.setItem("golf_dispersion_history", JSON.stringify(newHistory));
    alert(`${drillName} session saved successfully.`);
  };

  const tabs = [
    { id: "dispersion", label: "20-Shot Dispersion" },
    { id: "combine", label: "7-Iron Combine" },
    { id: "wedge", label: "Wedge Matrix" },
    { id: "scramble", label: "Scramble Test" },
    { id: "impact", label: "The Big 3" },
    { id: "decade", label: "DECADE Tiger 5" },
    { id: "coach", label: "AI Coach" },
    { id: "targets", label: "Bag Setup" }
  ];

  return (
    <div style={{ fontFamily: "'Montserrat', sans-serif", background: "#1A1A1A", minHeight: "100vh", padding: 0, color: "#F9F9F9" }}>
      <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,400&family=Montserrat:wght@300;400;500;600&display=swap" rel="stylesheet" />

      {/* Global Header */}
      <div style={{ background: "#1A1A1A", padding: "40px 24px", borderBottom: "0.5px solid rgba(212, 175, 55, 0.3)" }}>
        <div style={{ maxWidth: "1000px", margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "32px" }}>
          <div>
            <h1 style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "48px", margin: 0, fontWeight: 400, letterSpacing: "1px" }}>Dispersion Lab</h1>
            <p style={{ fontFamily: "'Montserrat', sans-serif", fontSize: "12px", color: "#D4AF37", margin: "8px 0 0 0", textTransform: "uppercase", letterSpacing: "2px", fontWeight: 600 }}>Interactive Drill & Testing Protocols</p>
          </div>
          <div style={{ background: "rgba(255,255,255,0.02)", padding: "20px 32px", borderRadius: "4px", border: "0.5px solid rgba(255,255,255,0.1)", minWidth: "250px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "16px" }}>
              <label style={{ fontFamily: "'Montserrat', sans-serif", fontSize: "10px", fontWeight: "600", letterSpacing: "1px", color: "#999999", textTransform: "uppercase" }}>Player Handicap</label>
              <span style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "32px", color: "#D4AF37" }}>{handicap}</span>
            </div>
            <input 
              type="range" 
              min={0} 
              max={25} 
              value={handicap} 
              onChange={e => setHandicap(parseInt(e.target.value))} 
              style={{ width: "100%", accentColor: "#D4AF37" }} 
            />
          </div>
        </div>
      </div>

      {/* Navigation */}
      <div style={{ background: "rgba(26,26,26,0.9)", borderBottom: "0.5px solid rgba(255,255,255,0.1)", position: "sticky", top: 0, zIndex: 10, backdropFilter: "blur(10px)" }}>
        <div style={{ maxWidth: "1000px", margin: "0 auto", display: "flex", overflowX: "auto" }}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id)} style={{
              padding: "20px 24px", border: "none", background: "transparent", cursor: "pointer", whiteSpace: "nowrap",
              fontFamily: "'Montserrat', sans-serif", fontSize: "12px", fontWeight: activeTab === t.id ? 600 : 400,
              color: activeTab === t.id ? "#D4AF37" : "#999999", borderBottom: activeTab === t.id ? "2px solid #D4AF37" : "2px solid transparent",
              transition: "all 0.3s ease", textTransform: "uppercase", letterSpacing: "1px"
            }}>{t.label}</button>
          ))}
        </div>
      </div>

      {/* Main Content Area */}
      <div style={{ maxWidth: "1000px", margin: "0 auto", padding: "40px 24px" }}>
        {activeTab === "dispersion" && <DispersionDrill handicap={handicap} customCarries={customCarries} />}
        {activeTab === "combine" && <CombineDrill handicap={handicap} customCarries={customCarries} saveSession={saveSession} />}
        {activeTab === "wedge" && <WedgeMatrixDrill saveSession={saveSession} />}
        {activeTab === "scramble" && <ScrambleDrill saveSession={saveSession} />}
        {activeTab === "impact" && <ImpactDrill saveSession={saveSession} />}
        {activeTab === "decade" && <DecadeDrill saveSession={saveSession} />}
        {activeTab === "coach" && <AICoachView history={history} handicap={handicap} saveSession={saveSession} />}
        {activeTab === "targets" && <TargetTables handicap={handicap} customCarries={customCarries} setCustomCarries={setCustomCarries} />}
      </div>
    </div>
  );
}
