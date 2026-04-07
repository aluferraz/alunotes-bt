import * as React from "react"
const AluNotesLogo = (props: React.JSX.IntrinsicAttributes & React.SVGProps<SVGSVGElement>) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="-20 -20 240 240" {...props}>
        <defs>
            <clipPath id="b">
                <circle cx={100} cy={120} r={50} />
                <path d="M85 40h30v50H85z" />
            </clipPath>
            <mask id="a">
                <path fill="#fff" d="M-20-20h240v240H-20z" />
                <circle cx={100} cy={120} r={50} />
                <path d="M85 40h30v50H85z" />
                <rect width={50} height={15} x={75} y={30} rx={5} />
            </mask>
        </defs>
        <g mask="url(#a)">
            <circle cx={100} cy={120} r={85} />
            <path d="M145 30h40v150q0 15-15 15h-25Z" />
        </g>
        <g fill="#6a2b91" clipPath="url(#b)">
            <path d="M50 130h100v50H50z" />
            <rect width={4} height={15} x={55} y={120} rx={2} />
            <rect width={4} height={25} x={62} y={110} rx={2} />
            <rect width={4} height={35} x={69} y={100} rx={2} />
            <rect width={4} height={20} x={76} y={115} rx={2} />
            <rect width={4} height={45} x={83} y={90} rx={2} />
            <rect width={4} height={30} x={90} y={105} rx={2} />
            <rect width={4} height={55} x={97} y={80} rx={2} />
            <rect width={4} height={40} x={104} y={95} rx={2} />
            <rect width={4} height={50} x={111} y={85} rx={2} />
            <rect width={4} height={25} x={118} y={110} rx={2} />
            <rect width={4} height={35} x={125} y={100} rx={2} />
            <rect width={4} height={20} x={132} y={115} rx={2} />
            <rect width={4} height={10} x={139} y={125} rx={2} />
        </g>
        <circle cx={95} cy={15} r={8} fill="#6a2b91" />
        <circle cx={75} cy={5} r={5} fill="#6a2b91" />
        <circle cx={115} r={6} fill="#6a2b91" />
        <circle cx={105} cy={65} r={4} fill="#6a2b91" />
        <circle cx={95} cy={55} r={2.5} fill="#6a2b91" />
    </svg>
)
export default AluNotesLogo
