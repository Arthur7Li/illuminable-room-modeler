// Import React's development-time safety wrapper; it intentionally double-runs
// some lifecycle paths so accidental side effects are easier to detect.
import { StrictMode } from 'react'
// Import the React 18+ root API used by Vite React apps.
import { createRoot } from 'react-dom/client'
// Load the global CSS baseline and Tailwind utility generator before rendering
// any component that uses utility class names.
import './index.css'
// Import the single top-level app component; all current UI and geometry logic
// lives below this component.
import App from './App.jsx'

// Find the DOM node supplied by index.html and attach the React tree to it.
createRoot(document.getElementById('root')).render(
  // Keep StrictMode at the root so every child benefits from React checks.
  <StrictMode>
    {/* Render the complete workbench application. */}
    <App />
  </StrictMode>,
)
