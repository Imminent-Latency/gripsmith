export interface PatternPreset {
    name: string;
    file: string;
    type: 'svg' | 'dxf' | 'stl';
    category: 'patterns' | 'inlays' | 'outlines';
    keepOriginalColors?: boolean;
    infoUrl?: string;
}

export const PRESETS: PatternPreset[] = [
    // Patterns
    { name: 'Pyramid', file: 'pyramid.stl', type: 'stl', category: 'patterns' },
    { name: 'GrippySheet V1', file: 'grippysheet-v1.stl', type: 'stl', category: 'patterns' },
    { name: 'Dome', file: 'dome.stl', type: 'stl', category: 'patterns' },
    { name: 'Stud', file: 'stud.stl', type: 'stl', category: 'patterns' },
    { name: 'Tryramid', file: 'tryramid.stl', type: 'stl', category: 'patterns' },
    { name: 'Hexyramid', file: 'hexyramid.stl', type: 'stl', category: 'patterns' },
    { name: 'Bevelled Cube', file: 'bevelled-cube.stl', type: 'stl', category: 'patterns' },
    { name: 'Skewed Pyramid', file: 'pyramid-skewed.stl', type: 'stl', category: 'patterns' },
    { name: 'Nipple', file: 'nipple.stl', type: 'stl', category: 'patterns' },
    { name: 'PubGrip', file: 'pubgrip.stl', type: 'stl', category: 'patterns' },
    { name: 'Thane Classic', file: 'thane-classic.stl', type: 'stl', category: 'patterns' },
    { name: 'Mitsi', file: 'mitsi.stl', type: 'stl', category: 'patterns' },
    { name: 'Polypore Single', file: 'polypore-single.stl', type: 'stl', category: 'patterns' },
    { name: 'Polypore Flower', file: 'polypore-flower.stl', type: 'stl', category: 'patterns' },
    
    // Inlays
    { name: 'GrippySheet', file: 'grippysheet.svg', type: 'svg', category: 'inlays', keepOriginalColors: true },
    { name: 'GrippySheet Alt', file: 'grippysheetalt.svg', type: 'svg', category: 'inlays', keepOriginalColors: true },
    { name: 'GrippySheet Drip', file: 'grippysheetdrip.svg', type: 'svg', category: 'inlays', keepOriginalColors: true },
    { name: 'GrippySheet Badge', file: 'grippysheetbadge.svg', type: 'svg', category: 'inlays', keepOriginalColors: true },
    { name: 'GrippySheet Alt Badge', file: 'grippysheetbadgealt.svg', type: 'svg', category: 'inlays', keepOriginalColors: true },
    { name: 'Pubmote', file: 'pubmote.svg', type: 'svg', category: 'inlays', keepOriginalColors: true },
    { name: 'Floatwheel', file: 'floatwheel.svg', type: 'svg', category: 'inlays', keepOriginalColors: true },
    { name: 'Trogdor the Burninator', file: 'trogdor.svg', type: 'svg', category: 'inlays', keepOriginalColors: true },
    { name: 'Spooderman', file: 'spooderman.svg', type: 'svg', category: 'inlays', keepOriginalColors: true },
    { name: 'Dolan Duck', file: 'dolan.svg', type: 'svg', category: 'inlays', keepOriginalColors: true },
    { name: 'Gooby', file: 'gooby.svg', type: 'svg', category: 'inlays', keepOriginalColors: true },
    { name: 'MatixBuilt', file: 'matixbuilt.svg', type: 'svg', category: 'inlays', keepOriginalColors: true },

    // Outlines
    { name: 'XR Stock', file: 'xrstock.dxf', type: 'dxf', category: 'outlines', infoUrl: 'https://www.printables.com/model/968803' },
    { name: 'XR Cobra/Viper', file: 'xrcobraviper.dxf', type: 'dxf', category: 'outlines', infoUrl: 'https://www.printables.com/model/968803' },
    { name: 'XR Kush Wide', file: 'xrkushwide.dxf', type: 'dxf', category: 'outlines', infoUrl: 'https://www.printables.com/model/968803' },
    { name: 'XR Mushies V2', file: 'xrmushiesv2.dxf', type: 'dxf', category: 'outlines', infoUrl: 'https://www.printables.com/model/968803' },
    { name: 'XR PubPad', file: 'xrpubpad.dxf', type: 'dxf', category: 'outlines' },
    { name: 'XR Stompies', file: 'xrstompies.dxf', type: 'dxf', category: 'outlines' },
    { name: 'XR Viperbite Wide', file: 'xrviperbitewide.dxf', type: 'dxf', category: 'outlines' },
    { name: 'Floatwheel ADV', file: 'floatwheeladv.dxf', type: 'dxf', category: 'outlines', infoUrl: 'https://www.printables.com/model/968803' },
    { name: 'Floatwheel Atom', file: 'floatwheelatom.dxf', type: 'dxf', category: 'outlines' },
    { name: 'GT Stock', file: 'gtstock.dxf', type: 'dxf', category: 'outlines', infoUrl: 'https://www.printables.com/model/968803' },
    { name: 'GT Kush Wide', file: 'gtkushwide.dxf', type: 'dxf', category: 'outlines', infoUrl: 'https://www.printables.com/model/968803' },
    { name: 'GT Mushies', file: 'gtmushies.dxf', type: 'dxf', category: 'outlines', infoUrl: 'https://www.printables.com/model/968803' },
    { name: 'GT FST', file: 'gtfst.dxf', type: 'dxf', category: 'outlines' },
    { name: 'GT Lowboy Flared', file: 'gtlowboyflared.dxf', type: 'dxf', category: 'outlines' },
    { name: 'Pint', file: 'pint.dxf', type: 'dxf', category: 'outlines', infoUrl: 'https://www.printables.com/model/968803' },
    { name: 'Pint Matix', file: 'pintmatix.dxf', type: 'dxf', category: 'outlines' },
    { name: 'Gosmilo X7', file: 'gosmilox7.dxf', type: 'dxf', category: 'outlines' }
];
