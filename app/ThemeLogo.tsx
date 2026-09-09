import logoDark from './logo-dark.png'
import logoLight from './logo-light.png'

export function ThemeLogo({
    className = '',
    alt = 'CleanPlateVA',
}: {
    className?: string
    alt?: string
}) {
    return (
        <div className={`relative inline-flex items-center justify-center ${className}`.trim()}>
            <img
                src={logoDark}
                alt={alt}
                width={2500}
                height={1201}
                aria-hidden={alt ? undefined : 'true'}
                className="block h-full w-auto max-w-full object-contain light:hidden"
            />
            <img
                src={logoLight}
                alt={alt}
                width={2500}
                height={1200}
                aria-hidden={alt ? undefined : 'true'}
                className="hidden h-full w-auto max-w-full object-contain light:block"
            />
        </div>
    )
}
