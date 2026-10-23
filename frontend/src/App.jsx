import { Outlet, Route, Routes } from "react-router-dom";

import { Header } from "./components/Header";
import Home from "./pages/Home";
import HowItWorks from "./pages/HowItWorks";
import NotFound from "./pages/NotFound";
import Run from "./pages/Run";
import Runs from "./pages/Runs";

function Layout() {
  return (
    <>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-accent focus:px-3 focus:py-2 focus:text-white">
        Skip to content
      </a>
      <Header />
      <main id="main" className="mx-auto w-full max-w-[1600px] px-4 pb-24 pt-4 sm:pb-10">
        <Outlet />
      </main>
    </>
  );
}

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="runs" element={<Runs />} />
        <Route path="runs/:id" element={<Run />} />
        <Route path="how-it-works" element={<HowItWorks />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
