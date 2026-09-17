import Landing from "./pages/landing";
import Login from "./pages/login";
import CandidateStatus from "./pages/candidate-status";
import RoleHome from "./pages/role-home";
import SkillGraph from "./pages/skill-graph";
import Recruitment from "./pages/recruitment";
import Onboarding from "./pages/onboarding";
import PolicyStudio from "./pages/policy-studio";
import NotFound from "./pages/NotFound";
import { ProtectedRoute } from "./components/protected-route";

export const routers = [
  {
    path: "/",
    name: "home",
    element: <Landing />,
  },
  {
    path: "/login",
    name: "login",
    element: <Login />,
  },
  {
    path: "/candidate-status",
    name: "candidate-status",
    element: <CandidateStatus />,
  },
  {
    path: "/app",
    name: "app",
    element: (
      <ProtectedRoute>
        <RoleHome />
      </ProtectedRoute>
    ),
  },
  {
    path: "/graph",
    name: "skill-graph",
    element: (
      <ProtectedRoute>
        <SkillGraph />
      </ProtectedRoute>
    ),
  },
  {
    path: "/recruitment",
    name: "recruitment",
    element: (
      <ProtectedRoute>
        <Recruitment />
      </ProtectedRoute>
    ),
  },
  {
    path: "/onboarding",
    name: "onboarding",
    element: (
      <ProtectedRoute>
        <Onboarding />
      </ProtectedRoute>
    ),
  },
  {
    path: "/policy",
    name: "policy-studio",
    element: (
      <ProtectedRoute>
        <PolicyStudio />
      </ProtectedRoute>
    ),
  },
  /* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */
  {
    path: "*",
    name: "404",
    element: <NotFound />,
  },
];

declare global {
  interface Window {
    __routers__: typeof routers;
  }
}

window.__routers__ = routers;
