// CR app bootstrap (CRF-M0); the served site since CRC (2026-09-06).
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './theme.css'
import { App } from './App'

const root = document.getElementById('root')
if (root) {
    createRoot(root).render(
        <StrictMode>
            <App />
        </StrictMode>,
    )
}
