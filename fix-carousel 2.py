import re

path = 'app/page.js'

with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Replace broken hour-based shuffle with stable module-level slice
content = re.sub(
    r'const _hour = Math\.floor\(Date\.now\(\)[^;]+;\s*const carouselStories = [^\n]+slice\(0, 5\);',
    'const carouselStories = _sorted.slice(0, 5);',
    content
)

# 2. Add carousel state after heroIndex state
content = content.replace(
    '[heroIndex, setHeroIndex] = useState(0);',
    '[heroIndex, setHeroIndex] = useState(0);\n  const [carousel, setCarousel] = useState(carouselStories);'
)

# 3. Add hourly shuffle useEffect after mobile useEffect
old_effect = '''  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth <= 1024);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);'''

new_effect = '''  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth <= 1024);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  useEffect(() => {
    const getHourlyCarousel = () => {
      const hour = Math.floor(Date.now() / 3600000);
      return [..._sorted].sort((a, b) => ((a.id.charCodeAt(0) * hour) % 13) - ((b.id.charCodeAt(0) * hour) % 13)).slice(0, 5);
    };
    setCarousel(getHourlyCarousel());
    const hourTimer = setInterval(() => {
      setHeroIndex(0);
      setCarousel(getHourlyCarousel());
    }, 3600000);
    return () => clearInterval(hourTimer);
  }, []);'''

content = content.replace(old_effect, new_effect)

# 4. Replace carouselStories references inside Home() component with carousel
# Split at export default to only replace inside the component
parts = content.split('export default function Home()')
if len(parts) == 2:
    component = parts[1].replace('carouselStories', 'carousel')
    content = parts[0] + 'export default function Home()' + component

# 5. Restore the module-level const (which got replaced in step 4)
content = content.replace(
    'const carousel = _sorted.slice(0, 5);',
    'const carouselStories = _sorted.slice(0, 5);'
)

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)

print('Done')
