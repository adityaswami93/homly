import axios from "axios"
import { supabase } from "./supabase"

const api = axios.create({
    baseURL: process.env.NEXT_PUBLIC_API_URL
})

// Attach token to every request automatically
api.interceptors.request.use(async (config) => {
    const { data: { session } } = await supabase.auth.getSession()
    if (session?.access_token) {
        config.headers.Authorization = `Bearer ${session.access_token}`
    }
    return config
})

// Handle 401 — redirect to login
api.interceptors.response.use(
    (response) => response,
    async (error) => {
        if (error.response?.status === 401) {
            await supabase.auth.signOut()
            window.location.href = "/login"
        }
        return Promise.reject(error)
    }
)

export default api
