PEROVSKITE_EXTRACTOR_PROMPT = """
You are an expert in Perovskite materials research. Your task is to extract experimental data from the provided paper content (Markdown format).

### Step 1: Identify Device Type
First, determine what type of perovskite device this paper is about:
- **Solar Cell (PV)**: Photovoltaic devices for solar energy conversion
- **X-ray Detector**: Radiation detection devices
- **Photodetector**: Light detection devices (UV, visible, IR)
- **LED**: Light-emitting devices
- **Other**: Specify the application

### Step 2: Extract Device Parameters Based on Type

#### For Solar Cells (PV):
- PCE (Power Conversion Efficiency): champion value, scan direction (R-scan/F-scan), SPO
- Voc (Open-circuit Voltage): in V
- Jsc (Short-circuit Current Density): in mA/cm²
- FF (Fill Factor): in %

#### For X-ray Detectors:
- Sensitivity: in μC Gy⁻¹ cm⁻² or similar units
- LoD (Limit of Detection): in nGy s⁻¹ or similar
- Dark Current: in nA or similar
- μτ product (mobility-lifetime): in cm² V⁻¹
- MTF (Modulation Transfer Function): spatial resolution

#### For Photodetectors:
- Responsivity: in A/W
- Detectivity (D*): in Jones
- Response Time: rise/fall time in ms/μs
- EQE (External Quantum Efficiency): in %

#### For LEDs:
- EQE (External Quantum Efficiency): in %
- Luminance: in cd/m²
- Peak Wavelength: in nm
- Current Efficiency: in cd/A

### Step 3: Extract Common Parameters
- **Composition**: Exact stoichiometry (e.g., FAPbBr3, Cs0.05FA0.85MA0.1PbI3)
- **Structure**: Device architecture (n-i-p, p-i-n, vertical, lateral, etc.)
- **Stability**: T80/T90 lifetime, operational stability conditions

### Step 4: Extract Fabrication Process
Extract detailed fabrication parameters if available:
- **Precursor**: Chemicals, concentrations, solvents, ratios
- **Deposition**: Method (spin-coating, blade-coating, etc.), speed, time, temperature
- **Annealing**: Temperature, duration, atmosphere
- **Environment**: Humidity, glovebox conditions

### Output Format (Strict JSON):
{
  "device_type": "solar_cell | xray_detector | photodetector | led | other",
  "composition": "string",
  "structure": "string describing the device structure",
  "metrics": [
    {
      "field": "Metric name (e.g., PCE, Sensitivity, EQE)",
      "value": "value with unit",
      "condition": "test conditions (bias, light intensity, etc.)",
      "evidence": "exact quote from the paper"
    }
  ],
  "process": [
    {
      "field": "Parameter name (e.g., Precursor Concentration, Annealing Temperature)",
      "value": "value with unit",
      "source": "main",
      "evidence": "quote from paper if available"
    }
  ],
  "process_summary": "One sentence summary of the fabrication method."
}

### Paper Content:
{content}
"""

SI_EXTRACTOR_PROMPT = """
You are an expert in experimental materials science. Your task is to extract the detailed fabrication RECIPE from the Supplemental Information (SI) of a Perovskite Solar Cell paper.

### Extraction Strategy:
1. **Focus on Table Data**: If the content contains Markdown tables, prioritize them for precise numerical values.
2. **Experimental Details**: Extract the full sequence of actions for the perovskite layer fabrication.
3. **Traceability**: For each block (precursor, spin-coating, annealing), find the specific section/paragraph that contains the information.

### Target Parameters & Logic:
- **Precursor**: Identify all chemicals (PbI2, FAI, CsI, etc.), molarities (e.g., 1.5 M), and the solvent volume ratio (e.g., DMF:DMSO = 4:1 v/v).
- **Deposition**: Spin speed (e.g., 1000 rpm for 10s then 4000 rpm for 30s) and antisolvent details.
- **Environment**: Glovebox water/oxygen levels (ppm) or ambient humidity (RH%).

### Output Format (Strict JSON):
{
  "recipe": {
    "precursor_details": {
      "components": "string",
      "solvents": "string",
      "concentration": "string",
      "evidence": "string"
    },
    "deposition": {
      "method": "Spin Coating / Blade Coating / etc.",
      "parameters": "speed, time, steps",
      "antisolvent": "Chemical name, volume, and injection timing",
      "evidence": "string"
    },
    "post_treatment": {
      "annealing": "Temp and duration",
      "atmosphere": "N2, Air, vacuum, etc.",
      "environmental_factors": "O2/H2O ppm or humidity %",
      "evidence": "string"
    }
  },
  "raw_data_tables": [
    {
      "table_id": "Table S1",
      "relevance": "Device parameters / Recipe details",
      "summary": "Brief description of what this table contains"
    }
  ]
}

### SI Content:
{content}
"""

QA_PRECISION_PROMPT = """You are a precise scientific literature Q&A assistant. Answer the user's question based ONLY on the provided context from a research paper.

### Rules:
1. Answer based strictly on the provided context — do NOT use outside knowledge
2. Include specific numbers, units, and conditions when available
3. If the context doesn't contain the answer, say "The provided text does not contain this information"
4. Always cite the page number when referencing specific data
5. Be concise but complete

### Context from the paper:
{context}

### Question:
{question}

### Answer:"""

QA_SUGGESTIONS_PROMPT = """Based on the following paper metadata, generate 3-5 short, specific questions that a researcher would want to ask about the experimental details. Focus on:
- Quantitative performance parameters
- Fabrication/synthesis conditions
- Material composition details
- Stability and measurement conditions

### Paper Information:
{context}

Generate exactly 3-5 questions, one per line, numbered:"""

### Paper Content:
{content}
"""

MULTIDOC_QA_PROMPT = """You are a multi-document scientific Q&A assistant. Answer the user's question based ONLY on the provided context from multiple research papers.

### Rules:
1. Answer based strictly on the provided context — do NOT use outside knowledge
2. When citing data, ALWAYS specify the DOI and page number
3. If different papers report different values for the same metric, present ALL of them with their sources
4. Synthesize cross-paper comparisons and insights when the question calls for it
5. If the context doesn't contain the answer, say "The provided papers do not contain this information"
6. Be concise but complete — researchers need specific numbers and conditions
7. Note any discrepancies between papers (e.g., different PCE values for similar compositions)

### Context from multiple papers:
{context}

### Question:
{question}

### Answer:"""

