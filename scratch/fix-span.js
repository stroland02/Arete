const fs = require('fs');

const filesToUpdate = [
  'C:\\\\Users\\\\strol\\\\arete-marble\\\\packages\\\\dashboard\\\\src\\\\app\\\\login\\\\login-form.tsx',
  'C:\\\\Users\\\\strol\\\\arete-marble\\\\packages\\\\dashboard\\\\src\\\\app\\\\signup\\\\signup-form.tsx',
  'C:\\\\Users\\\\strol\\\\arete-marble\\\\packages\\\\dashboard\\\\src\\\\components\\\\auth\\\\auth-brand-panel.tsx',
  'C:\\\\Users\\\\strol\\\\arete-marble\\\\packages\\\\dashboard\\\\src\\\\components\\\\dashboard\\\\sidebar.tsx',
  'C:\\\\Users\\\\strol\\\\arete-marble\\\\packages\\\\dashboard\\\\src\\\\components\\\\marketing\\\\landing-sections.tsx',
  'C:\\\\Users\\\\strol\\\\arete-marble\\\\packages\\\\dashboard\\\\src\\\\components\\\\marketing\\\\marketing-nav.tsx'
];

filesToUpdate.forEach(file => {
  if (fs.existsSync(file)) {
    let content = fs.readFileSync(file, 'utf8');
    content = content.replace(/Aret<span className="text-accent-secondary">é<\/span>( AI)?/g, 'Faber');
    fs.writeFileSync(file, content, 'utf8');
    console.log('Fixed', file);
  }
});
