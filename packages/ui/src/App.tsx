import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from '@/components/Layout';
import Overview from '@/pages/Overview';
import TaskList from '@/pages/TaskList';
import TaskDetail from '@/pages/TaskDetail';
import PostLibrary from '@/pages/PostLibrary';
import Strategies from '@/pages/Strategies';
import QueueMonitor from '@/pages/QueueMonitor';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Overview />} />
          <Route path="tasks" element={<TaskList />} />
          <Route path="tasks/:id" element={<TaskDetail />} />
          <Route path="posts" element={<PostLibrary />} />
          <Route path="strategies" element={<Strategies />} />
          <Route path="queue" element={<QueueMonitor />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
