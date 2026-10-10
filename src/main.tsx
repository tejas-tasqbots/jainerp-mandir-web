import React from 'react'
import ReactDOM from 'react-dom/client'
import { installIstDateFormatting } from './lib/istClock'
import App from './App'
import './lib/i18n'
import './index.css'

// Dates are drawn in IST whatever the PC's timezone says — see lib/istClock.
installIstDateFormatting()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
