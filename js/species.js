// Named chemical species beyond simple salts. Values are standard literature figures (CRC Handbook, NIST WebBook ranges) entered by hand.
// S(formula, name, melt K, boil K, density g/cm3, heat capacity J/g/K, conductivity W/m/K, heat of formation kJ/mol, colour, options)
// Options: colL liquid colour, colG [gas colour, alpha], note, visc, sol soluble in water, acid anion key of an acid, base, fuel autoignition K,
// colSol solution colour, cat and an for molecular acids or salts whose formula the parser cannot split, rhoL liquid density, alloy no fixed formula.
var SPECIES = {};
var SPECIES_HF = {};
(function () {
  function S(f, name, mp, bp, rho, cp, k, hf, col, o) {
    o = o || {};
    o.name = name; o.mp = mp; o.bp = bp; o.rho = rho; o.cp = cp; o.k = k; o.col = col;
    if (hf !== null) SPECIES_HF[f] = hf;
    SPECIES[f] = o;
  }
  var CLEAR = ["#e4e8ec", 10];

  // Oxides of nonmetals and small inorganic gases
  S("SO3", "Sulfur trioxide", 290, 318, 1.92, 0.75, 0.3, -395.7, "#f4f4ec", { colL: "#e8e8d8", colG: ["#f0f0e8", 50], note: "Fumes violently in moist air. Made in the contact process, one step short of sulfuric acid." });
  S("N2O", "Nitrous oxide", 182, 185, 1.23, 0.88, 0.1, 82.1, "#f0f0f4", { colG: CLEAR, note: "Laughing gas. Hot enough, it gives up its oxygen and supports combustion." });
  S("NO", "Nitric oxide", 109.5, 121.4, 1.27, 1.0, 0.1, 90.3, "#e8e8f0", { colG: CLEAR, note: "Colourless, until it meets air and browns into NO2." });
  S("N2O4", "Dinitrogen tetroxide", 262, 294.3, 1.44, 1.5, 0.2, 9.2, "#f4e8c0", { colL: "#d8b060", colG: ["#b06020", 80], note: "Rocket oxidiser, in equilibrium with brown NO2." });
  S("N2O5", "Dinitrogen pentoxide", 303, 320, 2.05, 0.9, 0.3, -43.1, "#f4f4f4", { colG: ["#d0a060", 40] });
  S("O3", "Ozone", 80.7, 161.3, 1.35, 0.8, 0.1, 142.7, "#5060c0", { colL: "#203090", colG: ["#a0b0f0", 40], note: "Blue, sharp-smelling and a stronger oxidiser than O2. UV light on oxygen makes it." });
  S("H2O2", "Hydrogen peroxide", 272.7, 423, 1.45, 2.6, 0.5, -187.8, "#e8f0f8", { colL: "#c8e0f0", sol: 1, visc: 0.08, note: "Falls apart into water and oxygen, in a rush with a manganese dioxide catalyst." });
  S("H2CO3", "Carbonic acid", 273, 373, 1.1, 2.5, 0.5, -699.7, "#e8f0f4", { sol: 1, acid: "CO3", colL: "#d8e8f0", note: "Why fizzy water tastes sharp. It falls back into water and CO2 easily." });
  S("H2SO3", "Sulfurous acid", 273, 373, 1.03, 2.5, 0.5, -608.8, "#e8f0e4", { sol: 1, acid: "SO3", colL: "#d8e8d0" });
  S("H3PO4", "Phosphoric acid", 315, 486, 1.88, 1.3, 0.3, -1284, "#f4f4ec", { colL: "#e8e8d0", sol: 1, acid: "PO4", visc: 0.3, note: "The sharp taste in cola." });
  S("HClO4", "Perchloric acid", 256, 476, 1.77, 1.2, 0.3, -40.6, "#f4f4f4", { colL: "#e8ecec", sol: 1, acid: "ClO4", note: "One of the strongest common acids, and a powerful oxidiser when hot." });
  S("HClO", "Hypochlorous acid", 273, 373, 1.1, 2.5, 0.5, -120.9, "#f0f4e8", { sol: 1, acid: "ClO", colL: "#e0ecc8", note: "What chlorine forms in swimming pools. The real disinfectant." });
  S("HCN", "Hydrogen cyanide", 260, 299, 0.69, 2.6, 0.2, 135.1, "#f0f0f4", { colL: "#e8e8f0", colG: CLEAR, sol: 1, fuel: 811, cat: 1, an: "CN", note: "Extremely toxic, with a bitter-almond smell." });
  S("HSCN", "Thiocyanic acid", 278, 419, 1.1, 2, 0.3, null, "#f4f0e0", { sol: 1, acid: "SCN", cat: 1, an: "SCN" });
  S("CH3COOH", "Acetic acid", 289.8, 391, 1.05, 2.05, 0.2, -484.5, "#f0f4f4", { colL: "#e0e8e8", sol: 1, acid: "CH3COO", cat: 1, an: "CH3COO", fuel: 700, note: "The acid in vinegar. Pure, it freezes at 17 C into glacial ice." });
  S("HCOOH", "Formic acid", 281.5, 374, 1.22, 2.15, 0.3, -425, "#f0f4f4", { colL: "#e0e8e8", sol: 1, fuel: 874, note: "The sting of an ant." });
  S("H2C2O4", "Oxalic acid", 462, 462, 1.9, 1.1, 0.3, -829.9, "#f4f4f4", { sol: 1, acid: "C2O4", note: "In rhubarb leaves. Reduces permanganate and clears it from purple to colourless." });
  S("H3BO3", "Boric acid", 444, 573, 1.44, 1.1, 0.3, -1094, "#f6f6f6", { sol: 1 });
  S("H2SiO3", "Silicic acid", 423, 1000, 2.1, 1.0, 0.5, -1189, "#f0f0ec", {});
  S("CS2", "Carbon disulfide", 161.6, 319.4, 1.26, 1.0, 0.15, 89, "#f0ecd8", { colL: "#e8e4c8", colG: ["#e0dcb8", 14], fuel: 363, note: "So easily lit that a hot pipe sets it off, at only 90 C." });
  S("COS", "Carbonyl sulfide", 134, 223, 1.03, 0.7, 0.1, -142, "#f0f0e8", { colG: CLEAR, fuel: 523 });
  S("PH3", "Phosphine", 140, 185, 0.75, 1.1, 0.1, 5.4, "#f0f0e8", { colG: CLEAR, fuel: 323, note: "Toxic, garlic-smelling and able to ignite spontaneously in air." });
  S("SiH4", "Silane", 88, 161, 0.68, 1.3, 0.1, 34.3, "#f0f0f4", { colG: CLEAR, fuel: 293, note: "Catches fire on contact with air." });
  S("B2H6", "Diborane", 108, 180, 0.42, 2.1, 0.1, 36.4, "#f0f0f4", { colG: CLEAR, fuel: 311 });
  S("AsH3", "Arsine", 157, 211, 1.64, 0.5, 0.1, 66.4, "#f0f0f0", { colG: CLEAR, fuel: 500, note: "The Marsh test for arsenic decomposes this gas into a metallic mirror." });
  S("H2Se", "Hydrogen selenide", 207, 232, 2.1, 0.4, 0.1, 29.7, "#f0f0f0", { colG: CLEAR, fuel: 500 });
  S("H2Te", "Hydrogen telluride", 224, 271, 2.57, 0.3, 0.1, 99.6, "#f0f0f0", { colG: CLEAR, fuel: 500 });
  S("N2H4", "Hydrazine", 275, 387, 1.02, 3.1, 0.3, 50.6, "#f0f4f8", { colL: "#e0e8f0", sol: 1, fuel: 297, note: "Rocket fuel that needs no spark on an iridium catalyst." });
  S("HN3", "Hydrazoic acid", 193, 310, 1.09, 1.5, 0.2, 264, "#f0f0f0", { sol: 1 });
  S("NH2OH", "Hydroxylamine", 306, 331, 1.21, 2, 0.3, -114, "#f4f4f4", { sol: 1 });
  S("NI3", "Nitrogen triiodide", 233, 310, 3.5, 0.2, 0.1, 287, "#3a1818", { note: "So unstable when dry that a feather's touch detonates it, in a purple cloud of iodine." });
  S("NCl3", "Nitrogen trichloride", 233, 344, 1.65, 0.6, 0.2, 230, "#e8d840", { colL: "#d8c830", note: "A violently unstable yellow oil. It cost its discoverer an eye and fingers." });
  S("NF3", "Nitrogen trifluoride", 66, 144, 1.5, 0.7, 0.1, -132, "#f0f0f0", { colG: CLEAR });
  S("OF2", "Oxygen difluoride", 49, 128, 1.9, 0.8, 0.1, 24.5, "#f0f0c8", { colG: ["#e8e8a0", 20] });
  S("ClF3", "Chlorine trifluoride", 197, 285, 1.8, 0.7, 0.2, -163, "#e8e8c0", { colL: "#d8d8a0", colG: ["#e0e0a0", 30], note: "Sets fire to concrete, asbestos and sand. No sane person handles it." });
  S("SF6", "Sulfur hexafluoride", 223, 209, 1.88, 0.66, 0.02, -1220, "#f4f4f4", { colG: CLEAR, note: "Five times heavier than air, so a foil boat floats on it. Inert." });
  S("SCl2", "Sulfur dichloride", 151, 332, 1.62, 0.8, 0.2, -50, "#a02818", { colL: "#a02818" });
  S("S2Cl2", "Disulfur dichloride", 193, 411, 1.69, 0.9, 0.2, -59, "#d0a020", { colL: "#d0a020" });
  S("PCl3", "Phosphorus trichloride", 179, 349, 1.57, 0.9, 0.2, -319.7, "#f0f0e8", { colL: "#e8e8e0", colG: ["#e0e0d0", 30], cat: 15, an: "Cl" });
  S("PCl5", "Phosphorus pentachloride", 433, 433, 2.1, 0.7, 0.2, -443.5, "#f0f0c0", { cat: 15, an: "Cl" });
  S("POCl3", "Phosphoryl chloride", 274, 379, 1.65, 0.9, 0.2, -597, "#f0f0e8", { colL: "#e8e8e0" });
  S("SiCl4", "Silicon tetrachloride", 204, 330, 1.48, 0.85, 0.2, -687, "#f0f0f0", { colL: "#e8e8e8", colG: ["#e8e8e8", 60], cat: 14, an: "Cl", note: "Fumes in moist air, and is purified on the way to making chips." });
  S("CCl4", "Carbon tetrachloride", 250, 349.9, 1.59, 0.86, 0.1, -128, "#f0f0f0", { colL: "#e4ecec", colG: CLEAR, note: "A once-common fire extinguisher, now known to wreck livers and ozone." });
  S("CHCl3", "Chloroform", 209.6, 334, 1.49, 0.96, 0.12, -134, "#f0f0f0", { colL: "#e4ecec", colG: CLEAR, note: "Early anaesthetic, heavy enough to sit below water." });
  S("CH2Cl2", "Dichloromethane", 176, 313, 1.33, 1.2, 0.14, -124, "#f0f0f0", { colL: "#e4ecec", colG: CLEAR });
  S("CH3Cl", "Chloromethane", 175, 249, 0.92, 1.6, 0.1, -81.9, "#f0f0f0", { colG: CLEAR, fuel: 905 });
  S("CF4", "Tetrafluoromethane", 89, 145, 1.6, 0.7, 0.05, -933, "#f4f4f4", { colG: CLEAR });
  S("COCl2", "Phosgene", 155, 281, 1.43, 0.7, 0.1, -219, "#f0f0f0", { colG: ["#e8e8e0", 18], note: "A First World War poison gas with a smell of musty hay." });
  S("AlCl3", "Aluminium chloride", 465, 453, 2.48, 0.79, 0.3, -704.2, "#f4f4ec", { colG: ["#f0f0e8", 50], note: "Sublimes as a white smoke. Reacts hard with water." });
  S("TiCl4", "Titanium tetrachloride", 249, 409, 1.73, 0.76, 0.2, -804, "#f0f0e8", { colL: "#e8e8d8", note: "Skywriting smoke: it forms dense white clouds on contact with moist air." });
  S("SnCl4", "Tin(IV) chloride", 239, 387, 2.23, 0.63, 0.2, -511, "#f0f0e8", { colL: "#e8e8e0" });
  S("UF6", "Uranium hexafluoride", 337, 330, 5.09, 0.4, 0.2, -2197, "#f4f4f4", { colG: ["#e8e8e8", 40], note: "Sublimes at 56 C, which is why gas centrifuges use it to enrich uranium." });
  S("XeF4", "Xenon tetrafluoride", 390, 500, 4.04, 0.4, 0.5, -251, "#f6f6f6", {});
  S("XeF6", "Xenon hexafluoride", 322, 348, 3.56, 0.4, 0.5, -294, "#f0f0c0", { colG: ["#e8e8a0", 30] });
  S("XeO3", "Xenon trioxide", 298, 298, 4.55, 0.3, 0.5, 402, "#f6f6f6", { note: "A dry crystal of this explodes like TNT." });
  S("Ni(CO)4", "Nickel carbonyl", 256, 316, 1.32, 1.0, 0.1, -632, "#f0f0e8", { colL: "#e8e8e0", colG: CLEAR, fuel: 333, note: "The Mond process refines nickel through this toxic liquid." });
  S("Fe(CO)5", "Iron pentacarbonyl", 253, 376, 1.45, 1.2, 0.1, -774, "#d8a020", { colL: "#d8a020", fuel: 322 });

  // Ammonium salts, peroxides and other special salts
  S("NH4Cl", "Ammonium chloride", 611, 611, 1.53, 1.57, 0.5, -314.4, "#f6f6f6", { sol: 1, colG: ["#f0f0f0", 70], note: "The white smoke when ammonia meets hydrochloric acid vapour." });
  S("NH4NO3", "Ammonium nitrate", 443, 483, 1.72, 1.74, 0.5, -365.6, "#f6f6f6", { sol: 1, note: "Fertiliser and blasting agent. Dissolving it chills water, which is how cold packs work." });
  S("(NH4)2SO4", "Ammonium sulfate", 553, 553, 1.77, 1.4, 0.5, -1180.9, "#f6f6f6", { sol: 1 });
  S("(NH4)2CO3", "Ammonium carbonate", 331, 331, 1.5, 1.4, 0.5, -941.9, "#f6f6f6", { sol: 1, note: "Smelling salts." });
  S("(NH4)2Cr2O7", "Ammonium dichromate", 453, 453, 2.15, 1.0, 0.5, -1806, "#e06818", { sol: 1, colSol: "#e87818", note: "Light it and a small volcano throws out green chromium oxide." });
  S("NH4SCN", "Ammonium thiocyanate", 422, 443, 1.3, 1.5, 0.5, -78.7, "#f6f6f6", { sol: 1 });
  S("Ba(OH)2", "Barium hydroxide", 681, 1050, 2.18, 0.8, 0.5, -944.7, "#f6f6f6", { sol: 1, note: "Stir with ammonium salts and the beaker freezes to the bench." });
  S("Na2O2", "Sodium peroxide", 733, 930, 2.8, 0.9, 0.5, -510.9, "#f0e8c0", { note: "Releases oxygen with water and absorbs CO2. Used to refresh air on submarines." });
  S("BaO2", "Barium peroxide", 723, 1073, 5.68, 0.4, 0.5, -634, "#f0f0e8", {});
  S("KO2", "Potassium superoxide", 833, 833, 2.14, 1.0, 0.5, -284.9, "#e8c040", { note: "Emergency breathing sets use it to swap breathed CO2 for oxygen." });
  S("CaC2", "Calcium carbide", 2430, 2573, 2.22, 0.96, 0.5, -59.8, "#3a3a40", { note: "Add water and acetylene comes off, the gas in old miners' lamps." });
  S("Al4C3", "Aluminium carbide", 2373, 2500, 2.36, 0.9, 1, -209, "#c8b050", {});
  S("SiC", "Silicon carbide", 3003, 3103, 3.21, 0.69, 120, -65.3, "#28383c", { note: "Carborundum. Nearly as hard as diamond." });
  S("Fe3O4", "Iron(II,III) oxide", 1870, 2896, 5.17, 0.62, 5, -1118, "#201c1c", { note: "Magnetite, the first magnet people knew." });
  S("Hg2Cl2", "Mercury(I) chloride", 655, 655, 7.15, 0.2, 0.5, -265, "#f4f4f4", { note: "Calomel, once a common and dangerous medicine." });
  S("NaAlO2", "Sodium aluminate", 1923, 2500, 2.7, 1, 1, -1133, "#f4f4f4", { sol: 1 });
  S("Na2ZnO2", "Sodium zincate", 1000, 2000, 2.8, 0.8, 1, null, "#f4f4f4", { sol: 1 });
  S("CaSO3", "Calcium sulfite", 900, 1500, 2.5, 0.8, 1, -1159, "#f4f4f0", {});
  S("Na2S2O3", "Sodium thiosulfate", 321, 373, 1.67, 1.1, 0.5, -1123, "#f4f4f4", { sol: 1, note: "Photographer's fixer. Also turns iodine colourless in the classic titration." });
  S("Na2S4O6", "Sodium tetrathionate", 500, 600, 2, 1, 0.5, null, "#f4f4f4", { sol: 1 });
  S("KMnO4", "Potassium permanganate", 513, 513, 2.7, 0.76, 0.5, -837.2, "#401050", { sol: 1, colSol: "#8a1090", note: "Deep purple oxidiser. A few grains colour a whole flask." });
  S("K2MnO4", "Potassium manganate", 463, 463, 2.7, 0.7, 0.5, -1180, "#106030", { sol: 1, colSol: "#108040" });
  S("MnO2", "Manganese dioxide", 808, 808, 5.03, 0.62, 2, -520, "#1c1818", { note: "Black catalyst that makes peroxide foam and chlorate give up oxygen." });
  S("KClO3", "Potassium chlorate", 629, 673, 2.34, 0.83, 0.5, -397.7, "#f6f6f6", { sol: 1, note: "Strike-anywhere match heads. With sugar and a drop of acid, it bursts into purple flame." });
  S("KClO4", "Potassium perchlorate", 798, 873, 2.52, 0.8, 0.5, -432.8, "#f6f6f6", {});
  S("NaClO", "Sodium hypochlorite", 291, 374, 1.11, 2.5, 0.5, -347, "#e8f0d8", { sol: 1, colSol: "#d0e0a0", note: "Household bleach. Never mix with acid or ammonia." });
  S("Ca(ClO)2", "Calcium hypochlorite", 373, 448, 2.35, 0.8, 0.5, -748, "#f4f4ec", { note: "Pool chlorine." });
  S("KNO3", "Potassium nitrate", 607, 673, 2.11, 0.95, 0.5, -494.6, "#f6f6f6", { sol: 1, note: "Saltpetre, the oxidiser in gunpowder." });
  S("NaNO3", "Sodium nitrate", 581, 653, 2.26, 1.1, 0.5, -467.9, "#f6f6f6", { sol: 1 });
  S("NaNO2", "Sodium nitrite", 544, 593, 2.17, 1, 0.5, -358.7, "#f4f0c8", { sol: 1 });
  S("KNO2", "Potassium nitrite", 714, 810, 1.92, 0.9, 0.5, -369.8, "#f4f0c8", { sol: 1 });
  S("K2CrO4", "Potassium chromate", 1241, 1500, 2.73, 0.75, 0.5, -1403, "#e8d010", { sol: 1, colSol: "#f0d820" });
  S("K2Cr2O7", "Potassium dichromate", 671, 773, 2.68, 0.75, 0.5, -2062, "#e05818", { sol: 1, colSol: "#e87818", note: "The orange-to-green colour change was the old breathalyser test." });
  S("Cr2O3", "Chromium(III) oxide", 2708, 4270, 5.22, 0.66, 10, -1139.7, "#3a7040", { note: "Chrome green pigment, tough enough for refractory bricks." });
  S("CrO3", "Chromium trioxide", 470, 523, 2.7, 0.8, 1, -589, "#a01810", { note: "So oxidising it sets ethanol alight on contact." });
  S("PbCrO4", "Lead(II) chromate", 1117, 1300, 6.12, 0.35, 0.5, -930.9, "#f0c010", { note: "Chrome yellow, the paint on American school buses." });
  S("BaCrO4", "Barium chromate", 1483, 1700, 4.5, 0.45, 0.5, -1446, "#e8d840", {});
  S("Ag2CrO4", "Silver chromate", 950, 1100, 5.63, 0.4, 0.5, -731.7, "#a02818", { note: "Blood-red solid and the indicator in the Mohr chloride titration." });
  S("Ag3PO4", "Silver phosphate", 1122, 1300, 6.37, 0.35, 0.5, -1110, "#e8e040", {});
  S("Ag2S", "Silver sulfide", 1098, 1200, 7.23, 0.3, 0.5, -32.6, "#141414", { note: "The black tarnish on silver." });
  S("Ag2CO3", "Silver carbonate", 491, 491, 6.08, 0.4, 0.5, -505.8, "#e8e8c8", {});
  S("PbS", "Lead(II) sulfide", 1391, 1554, 7.6, 0.2, 2, -100.4, "#181820", { note: "Galena, the shiny grey ore of lead." });
  S("CuS", "Copper(II) sulfide", 493, 493, 4.76, 0.5, 2, -53.1, "#101820", {});
  S("Cu2S", "Copper(I) sulfide", 1403, 1700, 5.6, 0.48, 2, -79.5, "#1c1c20", {});
  S("Cu2O", "Copper(I) oxide", 1508, 2073, 6.0, 0.45, 5, -168.6, "#b03018", { note: "The brick-red proof of a sugar in Benedict's and Fehling's tests." });
  S("Cu(OH)2", "Copper(II) hydroxide", 353, 353, 3.37, 0.8, 0.5, -450, "#60a0e0", { note: "Pale blue jelly. Ammonia redissolves it to a startling royal blue." });
  S("Fe(OH)3", "Iron(III) hydroxide", 773, 773, 3.4, 0.8, 0.5, -823, "#9a4a18", { note: "Rust-brown jelly." });
  S("Fe(OH)2", "Iron(II) hydroxide", 423, 423, 3.4, 0.8, 0.5, -569, "#7a8a68", { note: "Dirty green, and turns brown in air as it takes up oxygen." });
  S("FeO", "Iron(II) oxide", 1650, 3687, 5.74, 0.7, 3, -272, "#28241c", {});
  S("Al(OH)3", "Aluminium hydroxide", 573, 573, 2.42, 1.2, 0.5, -1276, "#f4f4f4", { note: "White gel that dissolves in acid and in strong base. Amphoteric." });
  S("Mg(OH)2", "Magnesium hydroxide", 623, 623, 2.34, 1.3, 0.5, -924.5, "#f4f4f4", { note: "Milk of magnesia." });
  S("Zn(OH)2", "Zinc hydroxide", 398, 398, 3.05, 0.9, 0.5, -642, "#f4f4f4", {});
  S("Ni(OH)2", "Nickel(II) hydroxide", 503, 503, 4.1, 0.9, 0.5, -530, "#60b070", {});
  S("Co(OH)2", "Cobalt(II) hydroxide", 441, 441, 3.6, 0.9, 0.5, -539, "#e0809a", {});
  S("Cr(OH)3", "Chromium(III) hydroxide", 423, 423, 3.1, 0.9, 0.5, -1064, "#587858", {});
  S("Mn(OH)2", "Manganese(II) hydroxide", 413, 413, 3.26, 0.9, 0.5, -695, "#e8e0d0", {});
  S("Pb(OH)2", "Lead(II) hydroxide", 418, 418, 7.6, 0.4, 0.5, -515, "#f4f4f4", {});
  S("MgCO3", "Magnesium carbonate", 623, 1200, 2.96, 1.0, 1, -1095.8, "#f6f6f6", { note: "Climbers' chalk." });
  S("Na2CO3", "Sodium carbonate", 1124, 1900, 2.54, 1.0, 1, -1130.7, "#f6f6f6", { sol: 1, note: "Washing soda." });
  S("K2CO3", "Potassium carbonate", 1164, 1700, 2.43, 0.83, 1, -1151, "#f6f6f6", { sol: 1, note: "Potash, from wood ashes." });
  S("BaCO3", "Barium carbonate", 1084, 1633, 4.29, 0.43, 1, -1216, "#f6f6f6", {});
  S("CuCO3", "Copper(II) carbonate", 473, 473, 3.9, 0.7, 1, -595, "#50a080", { note: "The green patina on old roofs and statues." });
  S("Na2SiO3", "Sodium silicate", 1361, 1700, 2.61, 1, 1, -1554.9, "#e8ecf0", { sol: 1, note: "Water glass, used in chemical gardens." });
  S("CaSiO3", "Calcium silicate", 1813, 2500, 2.92, 0.85, 1, -1634.9, "#d8d4c8", { note: "Slag floating on molten iron in a blast furnace." });
  S("Ca3(PO4)2", "Calcium phosphate", 1943, 2500, 3.14, 0.8, 1, -4120.8, "#f4f4f0", { note: "The mineral in bones and teeth." });
  S("MgCl2", "Magnesium chloride", 987, 1685, 2.32, 0.71, 1, -641.3, "#f6f6f6", { sol: 1, note: "Electrolysed in its molten form to make magnesium metal." });
  S("CaCl2", "Calcium chloride", 1045, 2208, 2.15, 0.67, 1, -795.4, "#f6f6f6", { sol: 1, note: "Road de-icer that heats up as it dissolves." });
  S("LiCl", "Lithium chloride", 878, 1655, 2.07, 1.13, 1, -408.6, "#f6f6f6", { sol: 1 });
  S("CaSO4", "Calcium sulfate", 1733, 2500, 2.96, 0.73, 1, -1434.5, "#f4f4f0", { note: "Gypsum and plaster of Paris." });
  S("ZnCl2", "Zinc chloride", 563, 1005, 2.91, 0.5, 0.5, -415, "#f6f6f6", { sol: 1 });
  S("ZnSO4", "Zinc sulfate", 953, 1013, 3.54, 0.6, 1, -982.8, "#f6f6f6", { sol: 1 });
  S("MgSO4", "Magnesium sulfate", 1397, 1500, 2.66, 0.8, 1, -1284.9, "#f6f6f6", { sol: 1, note: "Epsom salts." });
  S("K2SO4", "Potassium sulfate", 1342, 1962, 2.66, 0.75, 1, -1437.8, "#f6f6f6", { sol: 1 });
  S("KBr", "Potassium bromide", 1007, 1708, 2.74, 0.44, 2, -393.8, "#f6f6f6", { sol: 1 });
  S("MnCl2", "Manganese(II) chloride", 927, 1463, 2.98, 0.6, 1, -481.3, "#f0c8d0", { sol: 1, colSol: "#f0c8d0" });
  S("MnSO4", "Manganese(II) sulfate", 983, 1123, 3.25, 0.6, 1, -1065, "#f0c8d0", { sol: 1, colSol: "#f0d0d8" });
  S("BaCl2", "Barium chloride", 1235, 1833, 3.86, 0.38, 1, -858.6, "#f6f6f6", { sol: 1 });
  S("Na2S", "Sodium sulfide", 1449, 1700, 1.86, 1, 1, -364.8, "#f0e8c8", { sol: 1 });
  S("K2S", "Potassium sulfide", 1113, 1185, 1.74, 0.9, 1, -380.7, "#d8c8a0", { sol: 1 });
  S("Na2SO3", "Sodium sulfite", 1184, 1500, 2.63, 0.9, 1, -1100.8, "#f6f6f6", { sol: 1 });
  S("NaHSO4", "Sodium bisulfate", 588, 593, 2.74, 1, 1, -1125.5, "#f6f6f6", { sol: 1 });
  S("FeSO4", "Iron(II) sulfate", 953, 953, 3.65, 0.67, 1, -928.4, "#a0d0a8", { sol: 1, colSol: "#a0d8b0", note: "Green vitriol." });
  S("Fe2(SO4)3", "Iron(III) sulfate", 753, 753, 3.1, 0.7, 1, -2582, "#d8c8a0", { sol: 1, colSol: "#d8b050" });
  S("FeCl2", "Iron(II) chloride", 950, 1296, 3.16, 0.6, 1, -341.8, "#b0c890", { sol: 1, colSol: "#a0d0a0" });
  S("Fe(SCN)3", "Iron(III) thiocyanate", 400, 400, 2.5, 0.8, 0.5, null, "#700808", { sol: 1, colSol: "#a00810", note: "Blood-red solution, the old test for iron(III) and for fake stage blood." });
  S("[Cu(NH3)4]SO4", "Tetraamminecopper(II) sulfate", 400, 400, 1.8, 0.9, 0.5, null, "#1820a0", { sol: 1, colSol: "#2030d0", note: "Ammonia turns pale blue copper solutions a startling deep royal blue." });
  S("[Ag(NH3)2]NO3", "Tollens' reagent", 400, 400, 1.3, 1.5, 0.5, null, "#e8e8e8", { sol: 1, colSol: "#e0e4e8", note: "An aldehyde reduces it, leaving a true silver mirror on the glass." });
  S("Hg(SCN)2", "Mercury(II) thiocyanate", 438, 438, 3.71, 0.3, 0.5, 200, "#f4f4f4", { note: "Pharaoh's serpent: a spark sets a coiling snake of ash growing from a small pile." });
  S("Hg3N2", "Mercury nitride", 400, 500, 8, 0.2, 0.5, null, "#201818", {});

  // Hydrocarbons and organics
  S("C2H6", "Ethane", 90.4, 184.6, 0.55, 2.2, 0.1, -84, "#f0f4f8", { colG: CLEAR, fuel: 745 });
  S("C2H4", "Ethylene", 104, 169.4, 0.57, 2.2, 0.1, 52.4, "#f0f4f8", { colG: CLEAR, fuel: 723, note: "Ripens fruit, and builds polyethylene." });
  S("C2H2", "Acetylene", 192, 192, 0.62, 1.7, 0.1, 226.7, "#f0f4f8", { colG: CLEAR, fuel: 578, note: "The welder's gas, burning at over 3000 C in oxygen." });
  S("C3H8", "Propane", 85.5, 231, 0.58, 2.2, 0.1, -104.7, "#f0f4f8", { colG: CLEAR, fuel: 723, note: "Barbecue gas." });
  S("C4H10", "Butane", 134.6, 272.6, 0.6, 2.3, 0.1, -125.6, "#f0f4f8", { colG: CLEAR, fuel: 678, note: "Lighter fuel." });
  S("C8H18", "Octane", 216, 398.8, 0.70, 2.2, 0.13, -250, "#f0e8c0", { colL: "#e8dca0", colG: CLEAR, fuel: 479, visc: 0.04, note: "Representative of petrol. It floats on water while it burns." });
  S("C12H26", "Dodecane", 263.6, 489.5, 0.75, 2.2, 0.14, -351, "#f0e0a0", { colL: "#e0cc80", colG: CLEAR, fuel: 476, visc: 0.08, note: "Representative of diesel and kerosene." });
  S("C6H6", "Benzene", 278.7, 353.2, 0.88, 1.74, 0.14, 49, "#f0f4e8", { colL: "#e8ecd8", colG: CLEAR, fuel: 771, note: "The classic aromatic ring. Burns with a very sooty flame." });
  S("C7H8", "Toluene", 178, 383.8, 0.87, 1.7, 0.13, 12.4, "#f0f4e8", { colL: "#e8ecd8", colG: CLEAR, fuel: 753 });
  S("C10H8", "Naphthalene", 353, 491, 1.14, 1.3, 0.1, 78.5, "#f6f6f4", { colG: CLEAR, fuel: 799, note: "Mothballs." });
  S("CH3OH", "Methanol", 175.6, 337.8, 0.79, 2.5, 0.2, -239, "#f0f4f8", { colL: "#e4ecf4", colG: CLEAR, sol: 1, fuel: 737, note: "Burns with an almost invisible flame." });
  S("C2H5OH", "Ethanol", 159, 351.4, 0.79, 2.44, 0.17, -277.7, "#f0f4f8", { colL: "#e4ecf4", colG: CLEAR, sol: 1, fuel: 636, note: "Drinking alcohol. Burns with a clean blue flame." });
  S("C3H7OH", "Isopropanol", 184, 355.5, 0.79, 2.6, 0.14, -318, "#f0f4f8", { colL: "#e4ecf4", colG: CLEAR, sol: 1, fuel: 672 });
  S("C3H8O3", "Glycerol", 291, 563, 1.26, 2.4, 0.29, -669, "#f0f4f4", { colL: "#e4ecec", sol: 1, fuel: 643, visc: 0.7, note: "A sweet, thick by-product of soap making. Potassium permanganate sets it alight." });
  S("C2H6O2", "Ethylene glycol", 260, 470, 1.11, 2.4, 0.25, -460, "#f0f4f4", { colL: "#d0e8d0", sol: 1, fuel: 671, visc: 0.3, note: "Antifreeze." });
  S("HCHO", "Formaldehyde", 181, 254, 0.82, 1.2, 0.1, -108.6, "#f0f4f4", { colG: CLEAR, sol: 1, fuel: 703 });
  S("CH3CHO", "Acetaldehyde", 150, 293, 0.78, 2, 0.2, -192, "#f0f4f4", { colL: "#e4ecec", colG: CLEAR, sol: 1, fuel: 448 });
  S("CH3COCH3", "Acetone", 178.5, 329.2, 0.79, 2.15, 0.16, -248, "#f0f4f4", { colL: "#e4ecec", colG: CLEAR, sol: 1, fuel: 738, note: "Nail varnish remover." });
  S("C2H5OC2H5", "Diethyl ether", 156.9, 307.8, 0.71, 2.3, 0.13, -279.6, "#f0f4f4", { colL: "#e4ecec", colG: CLEAR, fuel: 433, note: "Heavier-than-air vapour creeps along benches to find a flame." });
  S("CH3COOC2H5", "Ethyl acetate", 189.6, 350.3, 0.9, 1.9, 0.14, -479, "#f0f4f4", { colL: "#e4ecec", colG: CLEAR, fuel: 700, note: "Pear-drop smell, the product of a classic esterification." });
  S("C6H5OH", "Phenol", 314, 454.9, 1.07, 1.4, 0.2, -165, "#f4f0e8", { sol: 1, fuel: 868, note: "Lister's antiseptic." });
  S("C6H5NH2", "Aniline", 267, 457, 1.02, 2.06, 0.2, 31, "#e8d8b0", { colL: "#d8c090", fuel: 888 });
  S("C6H5NO2", "Nitrobenzene", 278.8, 483.9, 1.2, 1.5, 0.15, 12.5, "#f0e8a0", { colL: "#e8d870", fuel: 753 });
  S("C7H5N3O6", "TNT", 353.8, 513, 1.65, 1.1, 0.25, -67, "#f0e070", { note: "Trinitrotoluene. Surprisingly stable: it melts and pours safely, and needs a detonator." });
  S("C3H5N3O9", "Nitroglycerin", 286, 491, 1.6, 1.5, 0.2, -370, "#f0e8c0", { colL: "#e8e0a8", visc: 0.25, note: "Shock-sensitive liquid explosive, tamed by Nobel as dynamite." });
  S("C6H12O6", "Glucose", 419, 500, 1.54, 1.2, 0.3, -1273, "#f8f8f4", { sol: 1, fuel: 700, note: "Life's main fuel. Yeast ferments it, and Benedict's reagent tests for it." });
  S("C12H22O11", "Sucrose", 459, 500, 1.59, 1.25, 0.3, -2222, "#f8f8f4", { sol: 1, fuel: 623, note: "Table sugar. Sulfuric acid strips the water out and leaves a rising snake of carbon." });
  S("C6H10O5", "Cellulose", 533, 533, 1.5, 1.3, 0.2, -960, "#b08858", { note: "Wood and paper. Burns on, then leaves charcoal when oxygen is short." });
  S("C57H110O6", "Tristearin", 346, 600, 0.86, 2, 0.17, -2300, "#f0ecd8", { colL: "#e8dca0", fuel: 588, note: "A representative animal fat. Boiled with lye, it makes soap." });
  S("C18H35NaO2", "Soap", 526, 600, 1.07, 2, 0.3, -1000, "#f0ecc8", { sol: 1, note: "Sodium stearate, the classic hard soap." });
  S("C18H36O2", "Stearic acid", 342.7, 656, 0.85, 2, 0.2, -947, "#f4f4ec", { fuel: 668 });
  S("CH4N2O", "Urea", 406, 408, 1.32, 1.6, 0.3, -333, "#f6f6f6", { sol: 1, note: "Wohler made it from inorganic salts in 1828, ending the idea that organic matter needs a vital force." });
  S("NH4OCN", "Ammonium cyanate", 353, 353, 1.3, 1.5, 0.3, null, "#f6f6f6", { sol: 1 });
  S("C2H4n", "Polyethylene", 403, 600, 0.95, 2.1, 0.4, null, "#ece8e0", { fuel: 622, alloy: 1, note: "Plastic. Chains of ethylene, the most made polymer of all." });
  S("C2H3Cln", "PVC", 373, 500, 1.38, 1, 0.2, null, "#e0e0d8", { alloy: 1, note: "Pipes and flooring." });
  S("C8H8n", "Polystyrene", 513, 700, 1.05, 1.3, 0.1, null, "#f0f0f0", { fuel: 761, alloy: 1 });
  S("C8H8", "Styrene", 243, 418, 0.91, 1.7, 0.15, 103, "#e8ecd8", { colL: "#e8ecd8", colG: CLEAR, fuel: 763 });
  S("C2H3Cl", "Vinyl chloride", 119, 260, 0.91, 1.3, 0.1, 37, "#f0f0f0", { colG: CLEAR, fuel: 745 });
  S("I2-starch", "Iodine-starch complex", 400, 500, 1.5, 1.2, 0.3, null, "#10105a", { alloy: 1, colSol: "#1818a0", sol: 1, note: "The midnight-blue test for starch." });
  S("Starch", "Starch", 530, 530, 1.5, 1.3, 0.2, null, "#f0ecd8", { alloy: 1, sol: 1, fuel: 683 });

  // Alloys. These have no fixed formula, so they stay out of the balance check. Values are typical for the common composition.
  S("Bronze", "Bronze", 1223, 2500, 8.8, 0.38, 60, null, "#b08848", { alloy: 1, note: "Copper and tin. It gave an age its name." });
  S("Brass", "Brass", 1200, 2300, 8.5, 0.38, 110, null, "#c8a848", { alloy: 1, note: "Copper and zinc." });
  S("Steel", "Steel", 1720, 3100, 7.85, 0.49, 50, null, "#7c8084", { alloy: 1, note: "Iron with a small share of carbon, which stops its crystals sliding." });
  S("StainlessSteel", "Stainless steel", 1720, 3000, 7.9, 0.5, 16, null, "#a8acb0", { alloy: 1, note: "Chromium forms a self-healing oxide skin." });
  S("Solder", "Solder", 456, 2000, 8.4, 0.2, 50, null, "#a8a8b0", { alloy: 1, note: "Tin and lead, melting lower than either metal." });
  S("Electrum", "Electrum", 1300, 3000, 15, 0.2, 200, null, "#e0d080", { alloy: 1, note: "Natural gold and silver. The first coins were made of it." });
  S("Nichrome", "Nichrome", 1673, 3000, 8.4, 0.45, 11, null, "#a0a4a0", { alloy: 1, note: "Nickel and chromium, the glowing wire in toasters." });
  S("NaK", "NaK", 261, 1058, 0.87, 0.97, 25, null, "#c8c8c0", { alloy: 1, note: "Sodium and potassium. Solids that melt together into a liquid at room temperature." });
  S("Galinstan", "Galinstan", 254, 1600, 6.44, 0.3, 16, null, "#c8d0d4", { alloy: 1, note: "Gallium, indium and tin. Liquid metal that replaces mercury in thermometers." });
  S("Amalgam", "Amalgam", 340, 629, 11, 0.2, 15, null, "#c0c4c8", { alloy: 1, note: "A metal dissolved in mercury. Fillings and old gold mining both relied on it." });
  S("WoodsMetal", "Wood's metal", 343, 1500, 9.6, 0.2, 20, null, "#b0b0b8", { alloy: 1, note: "Bismuth, lead, tin and cadmium. Melts in hot water." });

  // Species used only as reaction products or catalysts
  S("FeS2", "Iron pyrite", 1450, 1500, 5.01, 0.52, 20, -178, "#c8b048", { note: "Fool's gold." });
  S("H3PO3", "Phosphorous acid", 346, 473, 1.65, 1.5, 0.3, -964, "#f4f4ec", { sol: 1 });
  S("NaH2PO2", "Sodium hypophosphite", 583, 583, 1.8, 1.2, 0.4, null, "#f6f6f6", { sol: 1 });
  S("UO2F2", "Uranyl fluoride", 573, 573, 6.37, 0.3, 0.5, -1653, "#e8e040", { sol: 1, colSol: "#e8f040" });
  S("CH3COONa", "Sodium acetate", 597, 1154, 1.53, 1.2, 0.4, -708.8, "#f6f6f6", { sol: 1, cat: 11, an: "CH3COO", note: "Hot ice: a supersaturated solution freezes in seconds, giving off heat." });
  S("HAuCl4", "Chloroauric acid", 527, 527, 3.9, 0.4, 0.4, null, "#e0b020", { sol: 1, colSol: "#e8c020", note: "What aqua regia makes of gold." });
  S("H2PtCl6", "Chloroplatinic acid", 333, 333, 2.4, 0.5, 0.4, null, "#d08018", { sol: 1, colSol: "#e09020" });
  S("[Ag(NH3)2]Cl", "Diamminesilver(I) chloride", 400, 400, 1.5, 1, 0.5, null, "#f0f0f0", { sol: 1, colSol: "#e0e4e8" });
  S("NH4I", "Ammonium iodide", 824, 824, 2.51, 0.8, 0.5, -201.4, "#f6f6f6", { sol: 1 });
  S("C3N4", "Carbon nitride", 900, 1000, 2.3, 1, 0.5, null, "#807040", { alloy: 0 });
  S("Mg3B2", "Magnesium boride", 1100, 1500, 2.6, 0.9, 1, -92, "#403830", { cat: 12 });
  S("TiC", "Titanium carbide", 3433, 5093, 4.93, 0.56, 20, -184, "#3c3c44", { note: "Coats cutting tools." });
  S("WC", "Tungsten carbide", 3058, 6273, 15.63, 0.2, 110, -40.5, "#40404a", { note: "Drill bits and armour-piercing rounds." });
  S("Si3N4", "Silicon nitride", 2173, 2200, 3.17, 0.7, 30, -743, "#c8c4b8", {});
  S("C2H4Cl2", "1,2-Dichloroethane", 237.5, 356.7, 1.25, 1.3, 0.13, -167, "#f0f0f0", { colL: "#e4ecec", colG: CLEAR, fuel: 686 });
  S("C2H4Br2", "1,2-Dibromoethane", 283, 404.5, 2.18, 0.7, 0.1, -79, "#f0f0f0", { colL: "#e4e8e8", colG: CLEAR });
  S("C6H5Cl", "Chlorobenzene", 228, 404.9, 1.11, 1.3, 0.13, 11, "#f0f0f0", { colL: "#e4ecec", colG: CLEAR, fuel: 866 });
  S("C6H5Br", "Bromobenzene", 242, 429, 1.5, 1, 0.12, 60, "#f0f0f0", { colL: "#e4ecec", colG: CLEAR, fuel: 838 });
  S("C2H5ONa", "Sodium ethoxide", 533, 533, 0.87, 1.5, 0.3, -413, "#f4f0e0", { sol: 1 });
  S("CH3ONa", "Sodium methoxide", 400, 400, 1.3, 1.5, 0.3, -374, "#f4f0e0", { sol: 1 });
  S("C6H12O7", "Gluconic acid", 404, 500, 1.23, 1.5, 0.3, -1300, "#f4f4ec", { sol: 1 });
  S("Yeast", "Yeast", 340, 500, 1.1, 3, 0.4, null, "#d8c090", { alloy: 1, note: "Living catalyst. Ferments sugar into alcohol and CO2 between about 12 and 45 C." });
  S("Bacteria", "Acetobacter", 330, 500, 1.1, 3, 0.4, null, "#c8b890", { alloy: 1, note: "The bacteria that turn wine to vinegar." });

  // Indicators: dissolved dyes that change colour with pH. Shown by the renderer from the computed pH of the cell.
  S("Litmus", "Litmus", 450, 600, 1.2, 1.5, 0.3, null, "#7a4a90", { alloy: 1, sol: 1, colSol: "#7a4a90", note: "Red below pH 4.5, blue above pH 8.3." });
  S("Phenolphthalein", "Phenolphthalein", 535, 800, 1.3, 1.5, 0.3, null, "#f4f4f0", { alloy: 1, sol: 1, note: "Colourless below pH 8.2, vivid pink above it." });
  S("UniversalIndicator", "Universal indicator", 450, 600, 1.1, 1.5, 0.3, null, "#40a050", { alloy: 1, sol: 1, colSol: "#40a050", note: "A dye mixture that runs through the rainbow from pH 1 to 14." });

  // Heats of formation for compounds already listed in materials.js.
  var HF = {
    H2O: -285.8, CO2: -393.5, CO: -110.5, CH4: -74.8, NH3: -45.9, NO2: 33.2, SO2: -296.8, H2S: -20.6, HCl: -92.3, HF: -273.3, HBr: -36.3, HI: 26.5, H2SO4: -814, HNO3: -174.1,
    NaCl: -411.2, KCl: -436.5, NaOH: -425.8, KOH: -424.8, LiOH: -487.5, "Ca(OH)2": -985.2, CaCO3: -1207.6, NaHCO3: -950.8, CaO: -634.9, MgO: -601.6, Al2O3: -1675.7, SiO2: -910.7,
    Fe2O3: -824.2, CuO: -157.3, ZnO: -350.5, TiO2: -944, PbO: -219, HgO: -90.8, Ag2O: -31, UO3: -1224, UO2: -1085, CuCl2: -220, CuSO4: -771, AgNO3: -124, AgCl: -127, AgBr: -100.4, AgI: -61.8,
    PbI2: -175.5, PbCl2: -359.4, KI: -327.9, BaSO4: -1473, CdS: -162, HgS: -58, FeS: -100, ZnS: -206, P2O5: -1504, NaBr: -361, NaI: -287.8, NaF: -576.6, FeCl3: -399.5, Na2SO4: -1387, XeF2: -164, SiF4: -1615
  };
  Object.keys(HF).forEach(function (f) { SPECIES_HF[f] = HF[f]; });
})();

// Standard molar entropies at 298 K in J/mol/K, in the same state as the heats of formation above. Entered from standard tables; compounds without one
// skip the Gibbs energy check. Elements are per atom, so H2 at 130.7 appears as 65.3.
var SPECIES_S = { H2O: 69.9, CO2: 213.8, CO: 197.7, CH4: 186.3, NH3: 192.8, NO2: 240.1, NO: 210.8, N2O: 219.9, N2O4: 304.3, N2O5: 178.2, SO2: 248.2, SO3: 256.8, H2S: 205.8, HCl: 186.9, HF: 173.8, HBr: 198.7, HI: 206.6,
  H2SO4: 156.9, HNO3: 155.6, H3PO4: 110.5, H2O2: 109.6, O3: 238.9, NaCl: 72.1, KCl: 82.6, NaBr: 86.8, NaI: 98.5, NaF: 51.1, KI: 106.3, KBr: 95.9, LiCl: 59.3, NaOH: 64.5, KOH: 78.9, LiOH: 42.8, "Ca(OH)2": 83.4, "Mg(OH)2": 63.2, "Ba(OH)2": 107,
  "Al(OH)3": 71, "Fe(OH)3": 106.7, "Fe(OH)2": 88, "Cu(OH)2": 108, "Zn(OH)2": 81.2, CaCO3: 92.9, MgCO3: 65.7, BaCO3: 112.1, Na2CO3: 135, K2CO3: 155.5, NaHCO3: 101.7, CaO: 39.8, MgO: 26.9, BaO: 70.4, Na2O: 75.1, K2O: 94, Li2O: 37.6, Al2O3: 50.9, SiO2: 41.5,
  Fe2O3: 87.4, Fe3O4: 146.4, FeO: 60.8, CuO: 42.6, Cu2O: 93.1, ZnO: 43.7, TiO2: 50.6, PbO: 66.5, HgO: 70.3, Ag2O: 121.3, Cr2O3: 81.2, MnO2: 53, UO2: 77, UO3: 96.1, P2O5: 114.4, B2O3: 54, WO3: 75.9, MoO3: 77.7, SnO2: 49, CuCl2: 108.1, CuSO4: 109.2,
  AgNO3: 140.9, AgCl: 96.3, AgBr: 107.1, AgI: 115.5, PbI2: 174.9, PbCl2: 136, BaSO4: 132.2, CaSO4: 106.5, Na2SO4: 149.6, K2SO4: 175.6, ZnSO4: 110.5, MgSO4: 91.6, FeSO4: 107.5, MgCl2: 89.6, CaCl2: 108.4, BaCl2: 123.7, ZnCl2: 111.5, FeCl2: 118, FeCl3: 142.3, AlCl3: 109.3,
  NH4Cl: 94.6, NH4NO3: 151.1, "(NH4)2SO4": 220.1, KNO3: 133.1, NaNO3: 116.5, KClO3: 143.1, KClO4: 151, KMnO4: 171.7, K2CrO4: 200.1, K2Cr2O7: 291.2, CaC2: 70, Mg3N2: 88, NaH: 40, CaH2: 41, Na2O2: 95, KO2: 116.7, FeS: 60.3, FeS2: 52.9, ZnS: 57.7, CuS: 66.5, Cu2S: 120.9,
  PbS: 91.2, HgS: 82.4, CdS: 64.9, Ag2S: 144, SiC: 16.6, TiC: 24.2, WC: 32.4, PCl3: 217, PCl5: 166.5, POCl3: 222.5, SiCl4: 239.7, TiCl4: 252.3, SnCl4: 258.6, CCl4: 216.2, CHCl3: 201.7, CH2Cl2: 177.8, CH3Cl: 234.6, CF4: 261.6, SF6: 291.5, SiF4: 282.8, COCl2: 283.5, CS2: 151.3,
  PH3: 210.2, SiH4: 204.6, B2H6: 232.1, AsH3: 222.8, N2H4: 121.2, HCN: 112.8, C2H6: 229.2, C2H4: 219.3, C2H2: 200.9, C3H8: 270.3, C4H10: 310.2, C8H18: 361.1, C6H6: 173.4, C7H8: 220, CH3OH: 126.8, C2H5OH: 160.7, CH3COOH: 159.8, HCOOH: 129, HCHO: 218.8, CH3CHO: 160.2, CH3COCH3: 200.4,
  CH3COOC2H5: 257.7, C2H5OC2H5: 172.4, C6H12O6: 212.1, C12H22O11: 360.2, C3H8O3: 206.3, CH4N2O: 104.6, "Ni(CO)4": 320, "Fe(CO)5": 338.1, NaClO: 100, H3BO3: 88.8 };
var ELEMENT_S = { 1: 65.3, 2: 126.2, 3: 29.1, 4: 9.5, 5: 5.9, 6: 5.74, 7: 95.8, 8: 102.5, 9: 101.4, 10: 146.3, 11: 51.2, 12: 32.7, 13: 28.3, 14: 18.8, 15: 41.1, 16: 32.1, 17: 111.5, 18: 154.8, 19: 64.7, 20: 41.6, 22: 30.7, 23: 28.9, 24: 23.8, 25: 32, 26: 27.3, 27: 30, 28: 29.9, 29: 33.2, 30: 41.6, 33: 35.1, 34: 42.4, 35: 76.1, 36: 164.1, 38: 55, 40: 39, 42: 28.7, 46: 37.6, 47: 42.6, 48: 51.8, 50: 51.2, 51: 45.7, 52: 49.7, 53: 58.1, 54: 169.7, 55: 85.2, 56: 62.5, 74: 32.6, 77: 35.5, 78: 41.6, 79: 47.4, 80: 75.9, 82: 64.8, 83: 56.7, 92: 50.2 };
// Solubility products at 25 C. A salt falls out of solution only when its ion product passes this value.
var SALT_KSP = { AgCl: 1.8e-10, AgBr: 5e-13, AgI: 8.5e-17, Ag2CrO4: 1.1e-12, Ag2CO3: 8e-12, Ag3PO4: 8.9e-17, Ag2S: 6e-50, PbCl2: 1.7e-5, PbI2: 9.8e-9, PbSO4: 2.5e-8, PbCrO4: 2.8e-13, PbS: 3e-28, "Pb(OH)2": 1.4e-15, BaSO4: 1.1e-10, BaCrO4: 1.2e-10, BaCO3: 2.6e-9, CaCO3: 3.4e-9, CaSO4: 4.9e-5, CaF2: 3.4e-11,
  "Ca(OH)2": 5.5e-6, "Ca3(PO4)2": 2e-29, MgCO3: 6.8e-6, "Mg(OH)2": 5.6e-12, "Cu(OH)2": 2.2e-20, CuS: 6e-36, "Fe(OH)2": 4.9e-17, "Fe(OH)3": 2.8e-39, FeS: 6e-19, "Al(OH)3": 3e-34, "Zn(OH)2": 3e-17, ZnS: 2e-25, CdS: 8e-27, HgS: 2e-53, "Cr(OH)3": 6e-31, "Ni(OH)2": 5.5e-16, "Co(OH)2": 5.9e-15, "Mn(OH)2": 2e-13 };
// Solubility in mol/L at 25 C for some very soluble salts. Others use a typical 3 mol/L.
var SALT_SOLUBILITY = { NH4NO3: 24, NaCl: 6.1, KCl: 4.6, NaOH: 25, KOH: 19, KNO3: 3.1, NaNO3: 10.8, AgNO3: 12.6, CuSO4: 1.4, KI: 8.9, "Pb(NO3)2": 1.6, NaHCO3: 1.1, Na2CO3: 2, "Ba(OH)2": 0.22 };
// Acid strength. Strong acids dissociate fully and have no entry. pKa values at 25 C.
var ACID_PKA = { CH3COOH: 4.76, HF: 3.17, H2CO3: 6.35, H3PO4: 2.15, HCN: 9.21, HClO: 7.53, H2SO3: 1.81, H2S: 7.05, H2C2O4: 1.25, HCOOH: 3.75, H3BO3: 9.24, HSCN: 1.1, H3PO3: 1.3, H2SiO3: 9.8 };
