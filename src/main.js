import { createApp } from 'vue'
import { VueFire, VueFireAuth } from 'vuefire'
import './style.css'
import App from './App.vue'
import router from './router'
import { firebaseApp } from './firebase'

const app = createApp(App)

app.use(router)
app.use(VueFire, {
  firebaseApp,
  modules: [VueFireAuth()],
})

app.mount('#app')
