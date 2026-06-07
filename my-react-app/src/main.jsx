import '@vitejs/plugin-react/preamble'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './style.css'
import ArtIt from './ArtIt.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ArtIt />
  </StrictMode>,
)
