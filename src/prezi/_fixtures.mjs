// Shared test fixtures for the #3 generator. A small but contract-valid research §4 findings doc.

export function sampleResearch() {
  return {
    topic: 'Room-temperature superconductivity',
    narrative_outline: ['Why it matters', 'The 2025 claims', 'Reproduction status', 'What is next'],
    findings: [
      {
        claim: 'A nickelate film showed zero resistance near 290K under pressure',
        detail: 'A 2025 study reported a sharp resistive transition consistent with superconductivity in a pressurized nickelate thin film, though the effect was sensitive to sample preparation.',
        importance: 5,
        citations: ['lee2025'],
        figure: { caption: 'Resistance vs temperature', data_or_quote: 'Resistance dropped to <1µΩ between 288K and 291K at 12 GPa.' },
      },
      {
        claim: 'Independent groups have struggled to reproduce the transition',
        detail: 'Two follow-up attempts in 2025 did not observe the transition, attributing the original signal to a measurement artifact under non-hydrostatic pressure.',
        importance: 4,
        citations: ['ndiaye2025', 'patel2025'],
      },
      {
        claim: 'Diamond-anvil pressure calibration is a leading source of disagreement',
        detail: 'Reviewers note that pressure gradients across the sample can mimic a transition; standardized calibration is proposed.',
        importance: 3,
        citations: ['patel2025'],
      },
    ],
    citations: [
      { id: 'lee2025', title: 'Possible superconductivity in a pressurized nickelate', authors: ['Lee, J.', 'Kim, S.'], year: 2025, venue: 'Nature', doi: '10.0/lee', url: 'https://example.org/lee2025' },
      { id: 'ndiaye2025', title: 'Null result on nickelate superconductivity', authors: ['Ndiaye, A.'], year: 2025, venue: 'PRB', doi: '10.0/nd', url: 'https://example.org/nd2025' },
      { id: 'patel2025', title: 'Pressure calibration artifacts in anvil cells', authors: ['Patel, R.', 'Gomez, L.', 'Xu, W.'], year: 2025, venue: 'RSI', doi: '', url: 'https://example.org/patel2025' },
    ],
  };
}
